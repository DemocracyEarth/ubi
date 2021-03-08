const deploymentParams = require('../deployment-params');

async function main() {
  const UBIv2 = await ethers.getContractFactory("UBI");
  console.log("Upgrading proxy contract...");
  const UBIv2Address = await upgrades.upgradeProxy(deploymentParams.PROXY_CONTRACT_ADDRESS_KOVAN, UBIv2, { unsafeAllowCustomTypes: true });
  console.log("Proxy has been upgraded with UBI contract at:", UBIv2Address);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
