import * as k8s from "@pulumi/kubernetes";
import * as cloudflare from '@pulumi/cloudflare';
import * as pulumi from '@pulumi/pulumi';
import * as azure_native from '@pulumi/azure-native';

const appName: string = pulumi.getStack();

const generalProjectRef = new pulumi.StackReference('wijayasena/cluster-general/dev');
const resourceGroupName = generalProjectRef.getOutput('rgName');
const aksClusterName = generalProjectRef.getOutput('aksClusterName');

const creds = azure_native.containerservice.listManagedClusterUserCredentialsOutput({
    resourceGroupName: resourceGroupName,
    resourceName: aksClusterName,
});

const kubeconfig = creds.kubeconfigs[0].value.apply(enc => Buffer.from(enc, 'base64').toString());

const k8sProvider = new k8s.Provider(`${appName}-k8s-provider`, {
    kubeconfig: kubeconfig,
});

const appSvc = new k8s.core.v1.Service(`${appName}-svc`, {
    metadata: { name: appName },
    spec: {
        type: "ClusterIP",
        ports: [{ port: 80, targetPort: 8080 }],
        selector: { app: appName },
    },
}, { provider: k8sProvider });

const appDep = new k8s.apps.v1.Deployment(`${appName}-dep`, {
    metadata: { name: appName },
    spec: {
        replicas: 2,
        selector: {
            matchLabels: { app: appName },
        },
        template: {
            metadata: {
                labels: { app: appName },
            },
            spec: {
                containers: [{
                    name: appName,
                    image: "paulbouwer/hello-kubernetes:1.8",
                    ports: [{ containerPort: 8080 }],
                    env: [{ name: "MESSAGE", value: "Hello K8s!" }],
                }],
            },
        },
    },
}, { provider: k8sProvider });

export const appIngress = new k8s.networking.v1.Ingress(`${appName}-ingress`, {
    metadata: {
        name: `hello-k8s-${appName}-ingress`,
        annotations: {
            "kubernetes.io/ingress.class": "nginx",
        },
    },
    spec: {
        rules: [
            {
                // Replace this with your own domain!
                host: `${appName}.car-care.xyz`,
                http: {
                    paths: [{
                        pathType: "Prefix",
                        path: "/",
                        backend: {
                            service: {
                                name: appName,
                                port: { number: 80 },
                            },
                        },
                    }],
                }
            }
        ]
    }
}, { provider: k8sProvider });

const loadbalancerPublicIp = appIngress.status.loadBalancer.ingress[0].ip

const dnsRecord = new cloudflare.Record(`cloudflare-${appName}-dns`, {
    name: `${appName}.car-care.xyz`,
    zoneId: '9e65ba651133f5a0ffe8ac8745a51834',
    type: 'A',
    value: loadbalancerPublicIp,
    ttl: 1,
    proxied: true
});