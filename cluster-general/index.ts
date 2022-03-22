import * as azure_native from '@pulumi/azure-native';
import * as pulumi from '@pulumi/pulumi';
import * as tls from '@pulumi/tls'
import * as nginx from "@pulumi/kubernetes-ingress-nginx";
import * as k8s from "@pulumi/kubernetes";

const config = new pulumi.Config();
const stackName: string = pulumi.getStack();

// Create an Azure Resource Group.
const resourceGroupName = `ccc-${stackName}`;
const resourceGroup = new azure_native.resources.ResourceGroup(resourceGroupName, {
    'resourceGroupName': resourceGroupName
});

// Create virtual nekwork to have seperate subnets for postgreSQL server and AKS cluster.
const vnet = new azure_native.network.VirtualNetwork('ccc-vnet', {
    resourceGroupName: resourceGroup.name,
    addressSpace: { addressPrefixes: ['10.0.0.0/8'] }
}, {dependsOn: [resourceGroup]});

const clusterKey = new tls.PrivateKey(`ccc-${stackName}-key`, {
    algorithm: "RSA",
    rsaBits: 4096,
});

// Create subnet to host AKS cluster.
const aksSubnet = new azure_native.network.Subnet('cluster-subnet', {
    resourceGroupName: resourceGroup.name,
    virtualNetworkName: vnet.name,
    addressPrefix: '10.245.0.0/16'
});

// Create AKS cluster.
const k8sCluster = new azure_native.containerservice.ManagedCluster(`ccc-${stackName}-cluster`, {
    resourceGroupName: resourceGroupName,
    agentPoolProfiles: [{
        availabilityZones: [],
        count: config.getNumber('cluster-node-count') || 1,
        maxPods: config.getNumber('cluster-max-pods') || 110,
        mode: config.get('cluster-mode') || 'System',
        name: config.get('cluster-pool-name') || 'nodepool',
        nodeLabels: {},
        osDiskSizeGB: config.getNumber('cluster-os-disk-size') || 30,
        osType: 'Linux',
        type: 'VirtualMachineScaleSets',
        vmSize: config.get('cluster-nodeSize') || 'Standard_D2s_v3',
        vnetSubnetID: aksSubnet.id
    }],
    dnsPrefix: resourceGroupName,
    enableRBAC: true,
    kubernetesVersion: config.get('cluster-version') || '1.21.7',
    linuxProfile: {
        adminUsername: config.get('cluster-admin') || `cluster_${stackName}_admin`,
        ssh: {
            publicKeys: [{
                keyData: config.get('cluster-publicKey') || clusterKey.publicKeyOpenssh
            }],
        },
    },
    nodeResourceGroup: `ccc-${stackName}-node-rg`,
    networkProfile: {
        networkPlugin: 'azure',
        networkPolicy: 'calico',
        serviceCidr: '10.2.0.0/16',
        dnsServiceIP: '10.2.0.10',
        dockerBridgeCidr: '172.17.0.1/16'
    },
    identity: {
        type: 'SystemAssigned',
    },
}, {dependsOn: [aksSubnet, clusterKey]});


/*
// Create Azure Container registry.
const registry = new azure_native.containerregistry.Registry(`ccc${stackName}registry`, {
    resourceGroupName: resourceGroup.name,
    sku: {
        name: azure_native.containerregistry.SkuName.Standard
    },
    adminUserEnabled: true,
}, {dependsOn: [resourceGroup]});

// Credentials output for Azure Container registry.
const credentials = azure_native.containerregistry.listRegistryCredentialsOutput({
    resourceGroupName: resourceGroup.name,
    registryName: registry.name,
});

// Extract login for ACR.
const adminUsername = credentials.apply(credentials => credentials.username!);
const adminPassword = credentials.apply(credentials => credentials.passwords![0].value!);
*/

const creds = azure_native.containerservice.listManagedClusterUserCredentialsOutput({
    resourceGroupName: resourceGroup.name,
    resourceName: k8sCluster.name,
});

const kubeconfig = creds.kubeconfigs[0].value.apply(enc => Buffer.from(enc, 'base64').toString());

const k8sProvider = new k8s.Provider('k8s-provider', {
    kubeconfig: kubeconfig,
});

const ingressCtrl = new nginx.IngressController("ingress-ctrl", {
    controller: {
        publishService: {
            enabled: true,
        },
    },
}, { provider: k8sProvider });

//export const crServer = registry.loginServer;
//export const crAdminUsername = adminUsername;
//export const crAdminPassword = pulumi.secret(adminPassword);

export const aksClusterName = k8sCluster.name;
export const rgName = resourceGroup.name;