const deploymentParams = require('../deployment-params');

async function main() {

  const [deployer] = await ethers.getSigners();

  console.log(
    "Deploying DAO with the account:",
    deployer.address
  );

  console.log("Account balance:", (await deployer.getBalance()).toString());

  const DAO = await ethers.getContractFactory("Moloch");
  console.log("Deploying DAO...");

  const dao = await DAO.deploy(
    deploymentParams.SUMMONER,
    [deploymentParams.TOKEN],
    deploymentParams.PERIOD_DURATION_IN_SECONDS,
    deploymentParams.VOTING_DURATON_IN_PERIODS,
    deploymentParams.GRACE_DURATON_IN_PERIODS,
    deploymentParams.PROPOSAL_DEPOSIT,
    deploymentParams.DILUTION_BOUND,
    deploymentParams.PROCESSING_REWARD
  );

  console.log("DAO deployed to:", dao.address);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
