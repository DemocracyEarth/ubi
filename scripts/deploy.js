const deploymentParams = require('../deployment-params');

async function main() {

  const [deployer] = await ethers.getSigners();

  console.log(
    "Deploying contracts with the account:",
    deployer.address
  );
  
  console.log("Account balance:", (await deployer.getBalance()).toString());

  const Token = await ethers.getContractFactory("UBI");
  console.log("Deploying UBI Coin...");

  const token = await upgrades.deployProxy(
    Token,
    [
      deploymentParams.INITIAL_SUPPLY,
      deploymentParams.TOKEN_NAME,
      deploymentParams.TOKEN_SYMBOL,
      deploymentParams.ACCRUED_PER_SECOND,
      deploymentParams.PROOF_OF_HUMANITY_KOVAN
    ],
    {
      initializer: 'initialize',
      unsafeAllowCustomTypes: true 
    }
  );

  console.log("Token deployed to:", token.address);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
