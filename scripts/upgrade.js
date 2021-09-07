const deploymentParams = require('../deployment-params');

async function main() {
  const UBIv2 = await ethers.getContractFactory("UBI_v2");
  console.log("Upgrading proxy contract...");
  const ubiv2 = await upgrades.upgradeProxy(deploymentParams.PROXY_CONTRACT_ADDRESS_KOVAN, UBIv2);
  console.log("Proxy has been upgraded with UBI contract at:", ubiv2.address);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
