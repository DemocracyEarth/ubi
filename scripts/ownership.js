const deploymentParams = require('../deployment-params');

async function main() {
  console.log("Transferring ownership of ProxyAdmin...");
  // The owner of the ProxyAdmin can upgrade our contracts
  await upgrades.admin.transferProxyAdminOwnership(deploymentParams.PROXY_ADMIN);
  console.log("Transferred ownership of ProxyAdmin to:", deploymentParams.PROXY_ADMIN);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });