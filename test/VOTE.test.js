const { expect } = require("chai");
const deploymentParams = require('../deployment-params');

const SEVEN_BILLION = 7000000000;
const MAX_INT = '1000000000000000000';
const DECIMALS = 18;

/**
 @summary Tests for UBI.sol
*/
contract('Vote.sol', accounts => {
  describe('Vote token to democratically govern UBI DAO', () => {
    before(async () => {
      accounts = await ethers.getSigners();

      const [_addresses, mockProofOfHumanity] = await Promise.all([
        Promise.all(accounts.map((account) => account.getAddress())),
        waffle.deployMockContract(
          accounts[0],
          require("../artifacts/contracts/Vote.sol/IProofOfHumanity.json").abi
        ),
      ]);

      addresses = _addresses;

      setSubmissionIsRegistered = (submissionID, isRegistered) =>
        mockProofOfHumanity.mock.isRegistered
          .withArgs(submissionID)
          .returns(isRegistered);

      setSubmissionCounter = () =>
        mockProofOfHumanity.mock.submissionCounter
          .withArgs()
          .returns(SEVEN_BILLION);

      pohAddress = mockProofOfHumanity.address;

      Vote = await ethers.getContractFactory("Vote");
      vote = await Vote.deploy(deploymentParams.VOTE_NAME, deploymentParams.VOTE_SYMBOL, pohAddress);
      await vote.deployed();
      
      altProofOfHumanity = await waffle.deployMockContract(accounts[0], require("../artifacts/contracts/Vote.sol/IProofOfHumanity.json").abi);
    });

    it("happy path - check initialized values", async () => {
      // Check that the value passed to the constructor is set.
      expect((await vote.deployer()).toString()).to.equal(addresses[0]);
      expect(await vote.name()).to.equal(deploymentParams.VOTE_NAME);
      expect(await vote.symbol()).to.equal(deploymentParams.VOTE_SYMBOL);
      expect(await vote.decimals()).to.equal(DECIMALS);
      expect((await vote.proofOfHumanity()).toString()).to.equal(pohAddress);
    });

    it("happy path - get balance of 1 vote for a registered human", async () => {
      await setSubmissionIsRegistered(addresses[1], true);
      expect((await vote.balanceOf(addresses[1])).toString()).to.equal(MAX_INT);
    });

    it("happy path - get balance of 0 vote for a unregistered address", async () => {
      await setSubmissionIsRegistered(addresses[2], false);
      expect((await vote.balanceOf(addresses[2]))).to.equal(0);
    });

    it("happy path - verify if an address is human", async () => {
      await setSubmissionIsRegistered(addresses[3], true);
      expect((await vote.isHuman(addresses[3]))).to.equal(true);
    });

    it("happy path - prevent any kind of transfer", async () => {
      expect((await vote.transfer(addresses[1], 1))).to.equal(false);
    });

    it("happy path - prevent any kind of approval", async () => {
      expect((await vote.approve(addresses[2], 1))).to.equal(false);
    });

    it("happy path - prevent any kind of transferFrom", async () => {
      expect((await vote.transferFrom(addresses[1], addresses[2], 1))).to.equal(false);
    });

    it("happy path - emit snapshot event", async () => {
      expect(vote.snapshot()).to.emit(vote, "Snapshot");
    });

    it("happy path - get balance at a given snapshot id", async () => {
      await setSubmissionIsRegistered(addresses[1], true);
      await vote.snapshot();
      expect(await vote.balanceOfAt(addresses[1], 2)).to.equal(MAX_INT);
    });

    it("require fail - ERC20Snapshot: nonexistent id", async () => {
      await expect(vote.balanceOfAt(addresses[1], 10)).to.be.revertedWith("ERC20Snapshot: nonexistent id");
    });

    it("require fail - ERC20Snapshot: id is 0", async () => {
      await expect(vote.balanceOfAt(addresses[1], 0)).to.be.revertedWith("ERC20Snapshot: id is 0");
    });

    it("happy path - emit transfer event when registered", async () => {
      await setSubmissionIsRegistered(addresses[1], true);
      await setSubmissionCounter();
      expect(vote.register(addresses[1])).to.emit(vote, "Transfer");
    });

    it("happy path - get total supply", async () => {
      await setSubmissionCounter();
      expect(await vote.totalSupply()).to.equal(SEVEN_BILLION);
    });

    it("happy path - get total supply at a given snapshot id", async () => {
      await setSubmissionCounter();
      expect(await vote.totalSupplyAt(1)).to.equal(SEVEN_BILLION);
    });

    it("require fail - The caller must be the deployer", async () => {
      await expect(
        vote.connect(accounts[1]).changeProofOfHumanity(altProofOfHumanity.address)
      ).to.be.revertedWith("The caller must be the deployer");
    });

    it("happy path - change proof of humanity", async () => {
      await vote.changeProofOfHumanity(altProofOfHumanity.address);
      expect((await vote.proofOfHumanity()).toString()).to.equal(altProofOfHumanity.address);
    });

  });
})