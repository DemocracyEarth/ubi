const deploymentParams = require('../deployment-params');

async function main() {
  const UBIv2 = await ethers.getContractFactory("UBI_v2");
  console.log("Preparing upgrade...");
  const UBIv2Address = await upgrades.prepareUpgrade(deploymentParams.PROXY_CONTRACT_ADDRESS_KOVAN, UBIv2, { unsafeAllowCustomTypes: true });
  console.log("A new version of UBI was deployed at:", UBIv2Address);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });