const deploymentParams = require('../deployment-params');

task('deploy', 'Test deploy of a new instance of the UBI Coin')
  .setAction(async () => {
    if (deploymentParams.INITIAL_SUPPLY === '') {
      console.error('Please set the deployment parameters in deployment-params.js')
      return
    }

    // Make sure everything is compiled
    await run('compile')

    console.log('Deploying a new Universal Basic Income to the network ' + network.name)
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


    UBICoin = await ethers.getContractFactory("UBI");

    ubi = await upgrades.deployProxy(UBICoin,
      [deploymentParams.INITIAL_SUPPLY, deploymentParams.TOKEN_NAME, deploymentParams.TOKEN_SYMBOL, deploymentParams.ACCRUED_PER_SECOND, mockProofOfHumanity.address],
      { initializer: 'initialize', unsafeAllowCustomTypes: true }
    );

    await ubi.deployed();
    
    console.log("")
    console.log('UBI Coin deployed. Address:', ubi.address)
    console.log("Set this address in hardhat.config.js's networks section to use the other tasks")
  })
