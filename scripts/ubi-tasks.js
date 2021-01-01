const BN = require('bignumber.js')
const deploymentParams = require('../deployment-params')

task('ubi-deploy', 'Deploys a new instance of the UBI Coin')
  .setAction(async () => {
    if (deploymentParams.INITIAL_SUPPLY === '') {
      console.error('Please set the deployment parameters in deployment-params.js')
      return
    }

    // Make sure everything is compiled
    await run('compile')

    console.log('Deploying a new UBI Coin to the network ' + network.name)
    console.log(
      'Deployment parameters:\n',
      '  _initialSupply:', deploymentParams.INITIAL_SUPPLY, '\n',
      '  _name:', deploymentParams.TOKEN_NAME, '\n',
      '  _symbol:', deploymentParams.TOKEN_SYMBOL, '\n',
      '  _accruedPerSecond:', deploymentParams.ACCRUED_PER_SECOND, '\n',
    )
  
    const Confirm = require('prompt-confirm')
    const prompt = new Confirm('Please confirm that the deployment parameters are correct')
    const confirmation = await prompt.run()

    if (!confirmation) {
      return
    }

    console.log("Deploying...")

    accounts = await ethers.getSigners();

    const [_addresses, mockProofOfHumanity] = await Promise.all([
      Promise.all(accounts.map((account) => account.getAddress())),
      waffle.deployMockContract(
        accounts[0],
        require("../artifacts/contracts/UBI.sol/IProofOfHumanity.json").abi
      ),
    ]);
    addresses = _addresses;
    setSubmissionIsRegistered = (submissionID, isRegistered) =>
      mockProofOfHumanity.mock.getSubmissionInfo
        .withArgs(submissionID)
        .returns(0, 0, 0, 0, isRegistered, false, 0);

    UBICoin = await (
      await ethers.getContractFactory("UBI")
    ).deploy(deploymentParams.INITIAL_SUPPLY, deploymentParams.TOKEN_NAME, deploymentParams.TOKEN_SYMBOL, deploymentParams.ACCRUED_PER_SECOND, mockProofOfHumanity.address);

    await UBICoin.deployed();

    console.log("")
    console.log('UBI Coin deployed. Address:', UBICoin.address)
    console.log("Set this address in hardhat.config.js's networks section to use the other tasks")
  })
