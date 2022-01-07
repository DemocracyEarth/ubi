const deploymentParams = require('../deployment-params');

async function main() {
  
  // Get contract factory
  const ubiv2 = await ethers.getContractFactory("UBI");
  
  // Attach the deployed contract
  const deployed = ubiv2.attach(deploymentParams.PROXY_CONTRACT_ADDRESS_KOVAN);
  
  // Get values
  const governor = await deployed.governor();

  //await upgrades.upgradeProxy(KOVAN_PROXY_ADDRESS, PostaV3);
  console.log("Governor", governor.toString());

  // Get values
  const maxStreamsAllowed = await deployed.maxStreamsAllowed();

  //await upgrades.upgradeProxy(KOVAN_PROXY_ADDRESS, PostaV3);
  console.log("Max streams allowed", maxStreamsAllowed.toString());

  
  
  // Get values
  const poh = await deployed.proofOfHumanity();
  
  //await upgrades.upgradeProxy(KOVAN_PROXY_ADDRESS, PostaV3);
  console.log("POH", poh.toString());
  
  // Get values
  const testAccount = "0xb783De5Dc26F8930B8Afcc6DD1935faD1efabFD1";
  const accruedSince = await deployed.accruedSince(testAccount);

  //await upgrades.upgradeProxy(KOVAN_PROXY_ADDRESS, PostaV3);
  console.log("Accrued since", accruedSince.toString());
  
  const pohContract = await ethers.getContractAt("contracts\\UBI.sol:IProofOfHumanity", deploymentParams.PROOF_OF_HUMANITY_KOVAN);
  console.log(pohContract)
  //await upgrades.upgradeProxy(KOVAN_PROXY_ADDRESS, PostaV3);
  console.log("Is Registered", (await pohContract.isRegistered(testAccount)).toString());
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
