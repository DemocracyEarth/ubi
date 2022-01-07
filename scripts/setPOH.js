const deploymentParams = require('../deployment-params');

async function main() {
  
  try {
    
    // Get contract factory
    const ubiv2 = await ethers.getContractFactory("UBI");
  
    // Attach the deployed contract
    const deployed = ubiv2.attach(deploymentParams.PROXY_CONTRACT_ADDRESS_KOVAN);
    
    // Get values
    await deployed.changeProofOfHumanity(deploymentParams.PROOF_OF_HUMANITY_KOVAN);
    
    //await upgrades.upgradeProxy(KOVAN_PROXY_ADDRESS, PostaV3);
    console.log("Proof of Humanity changed to", deploymentParams.PROOF_OF_HUMANITY_KOVAN);
  } catch (error) {
    console.log("Error: ", error.message);
    console.log(JSON.stringify(error));
    
  }
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
