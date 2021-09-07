const deploymentParams = require('../deployment-params');

async function main() {
  
  // Get contract factory
  const ubiv2 = await ethers.getContractFactory("UBI_v2");
  
  // Attach the deployed contract
  const deployed = ubiv2.attach(deploymentParams.PROXY_CONTRACT_ADDRESS_KOVAN);
  
  // Get values
  const maxStreamsAllowed = await deployed.maxStreamsAllowed();

  //await upgrades.upgradeProxy(KOVAN_PROXY_ADDRESS, PostaV3);
  console.log("Max streams allowed", maxStreamsAllowed.toString());
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error("ERROR");
    console.error(error);
    // console.error(JSON.stringify(error));
    process.exit(1);
  });
