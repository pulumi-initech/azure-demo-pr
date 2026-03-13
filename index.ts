import * as pulumi from "@pulumi/pulumi";
import * as azure_native from "@pulumi/azure-native";
import * as synced_folder from "@pulumi/synced-folder";

// Import the program's configuration settings.
const config = new pulumi.Config();
const path = config.get("path") || "./www";
const indexDocument = config.get("indexDocument") || "index.html";
const errorDocument = config.get("errorDocument") || "error.html";

// Create a resource group for the website.
const resourceGroup = new azure_native.resources.ResourceGroup("resource-group", {});

// Create a blob storage account.
const account = new azure_native.storage.StorageAccount("account", {
    resourceGroupName: resourceGroup.name,
    kind: "StorageV2",
    sku: {
        name: "Standard_LRS",
    },
});

// Configure the storage account as a website.
const website = new azure_native.storage.StorageAccountStaticWebsite("website", {
    resourceGroupName: resourceGroup.name,
    accountName: account.name,
    indexDocument: indexDocument,
    error404Document: errorDocument,
});

// Use a synced folder to manage the files of the website.
const syncedFolder = new synced_folder.AzureBlobFolder("synced-folder", {
    path: path,
    resourceGroupName: resourceGroup.name,
    storageAccountName: account.name,
    containerName: website.containerName,
});

// Create an Azure Front Door profile (replaces classic CDN).
const profile = new azure_native.cdn.Profile("profile", {
    resourceGroupName: resourceGroup.name,
    location: "Global",
    sku: {
        name: "Standard_AzureFrontDoor",
    },
});

// Pull the hostname out of the storage-account endpoint.
const originHostname = account.primaryEndpoints.apply(endpoints => new URL(endpoints.web).hostname);

// Create an origin group for the Front Door endpoint.
const originGroup = new azure_native.cdn.AFDOriginGroup("origin-group", {
    resourceGroupName: resourceGroup.name,
    profileName: profile.name,
    loadBalancingSettings: {
        sampleSize: 4,
        successfulSamplesRequired: 3,
    },
    healthProbeSettings: {
        probePath: "/",
        probeRequestType: "HEAD",
        probeProtocol: "Https",
        probeIntervalInSeconds: 100,
    },
});

// Create an origin for the storage account.
const origin = new azure_native.cdn.AFDOrigin("origin", {
    resourceGroupName: resourceGroup.name,
    profileName: profile.name,
    originGroupName: originGroup.name,
    hostName: originHostname,
    httpPort: 80,
    httpsPort: 443,
    originHostHeader: originHostname,
    priority: 1,
    weight: 1000,
});

// Create an Azure Front Door endpoint.
const endpoint = new azure_native.cdn.AFDEndpoint("endpoint", {
    resourceGroupName: resourceGroup.name,
    profileName: profile.name,
    enabledState: "Enabled",
});

// Create a route to connect the endpoint to the origin group.
const route = new azure_native.cdn.Route("route", {
    resourceGroupName: resourceGroup.name,
    profileName: profile.name,
    endpointName: endpoint.name,
    originGroup: {
        id: originGroup.id,
    },
    supportedProtocols: ["Https"],
    patternsToMatch: ["/*"],
    forwardingProtocol: "HttpsOnly",
    linkToDefaultDomain: "Enabled",
    httpsRedirect: "Enabled",
}, { dependsOn: [origin, originGroup, endpoint] });

// Export the URLs and hostnames of the storage account and Azure Front Door.
export const originURL = account.primaryEndpoints.apply(endpoints => endpoints.web);
export { originHostname };
export const cdnURL = pulumi.interpolate`https://${endpoint.hostName}`;
export const cdnHostname = endpoint.hostName;
