const deploymentParams = require('../deployment-params');

async function main() {

  const [deployer] = await ethers.getSigners();

  console.log(
    "Deploying contracts with the account:",
    deployer.address
  );
  
  console.log("Account balance:", (await deployer.getBalance()).toString());

  const Token = await ethers.getContractFactory("UBI");
  const token = await Token.deploy(
    deploymentParams.INITIAL_SUPPLY, 
    deploymentParams.TOKEN_NAME, 
    deploymentParams.TOKEN_SYMBOL, 
    deploymentParams.ACCRUED_PER_SECOND, 
    deploymentParams.PROOF_OF_HUMANITY_KOVAN);

  console.log("Token address:", token.address);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
