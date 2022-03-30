import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { ethers, upgrades, network } from "hardhat";
import moment from "moment";
const testUtils = require("./testUtils");
const pohMockService = require("./utils/pohMockService");
const ubiMockService = require("./utils/ubiMockService");
const deploymentParams = require('../deployment-params');

async function deployFUBI(ubiInstance, governorAddress) {
    const FUBIFactory = await ethers.getContractFactory("fUBI");
    const fUBI = await FUBIFactory.deploy(ubiInstance.address, governorAddress,deploymentParams.FUBI_MAX_STREAMS_ALLOWED ,deploymentParams.FUBI_NAME, deploymentParams.FUBI_SYMBOL);
    await fUBI.deployed();
    await ubiInstance.setFUBI(fUBI.address);
    return fUBI;
}

async function deploySUBI(ubiInstance, governorAddress) {
  const SUBIFactory = await ethers.getContractFactory("sUBI");
  const sUBI = await SUBIFactory.deploy(ubiInstance.address, governorAddress, deploymentParams.SUBI_MAX_STREAMS_ALLOWED, deploymentParams.SUBI_NAME, deploymentParams.SUBI_SYMBOL);
  await sUBI.deployed();
  await ubiInstance.setSUBI(sUBI.address);
  return sUBI;
}

async function deployUBI(pohAddress) {

  const UBI_V1 = await ethers.getContractFactory("UBI");

  let ubi = await upgrades.deployProxy(UBI_V1,
    [deploymentParams.INITIAL_SUPPLY, deploymentParams.TOKEN_NAME, deploymentParams.TOKEN_SYMBOL, deploymentParams.ACCRUED_PER_SECOND, pohAddress],
    { initializer: 'initialize', unsafeAllowCustomTypes: true }
  );

  const UBICoin = await ethers.getContractFactory("UBI");
  ubi = await upgrades.upgradeProxy(ubi.address, UBICoin);
  return ubi;
}

describe("fUBI.sol", () => {

  let ubi;
  let sUBI;
  let mockUBI;
  let mockPoh;
  let fUBI;
  let accounts: SignerWithAddress[];
  let accruedPerSecond;

  beforeEach(async () => {

    // Get signers
    accounts = await ethers.getSigners();

    mockPoh = await pohMockService.deployMock(accounts[0]);

    // Deploy mock UBI
    mockUBI = await ubiMockService.deployMockUBI(accounts[0], mockPoh);
    ubi = await deployUBI(mockPoh.address);
    // Get the value of accruedPerSecond
    accruedPerSecond = await ubi.accruedPerSecond();

    sUBI = await deploySUBI(ubi, accounts[0].address);

    fUBI = await deployFUBI(ubi, accounts[0].address);

    await fUBI.setSUBI(sUBI.address);
  })

  describe("Basic tests", () => {
    it("Should correctly set contract initial parameters on deployment", async () => {
      // ASSERT
      expect(await fUBI.name()).to.equal(deploymentParams.FUBI_NAME);
      expect(await fUBI.symbol()).to.equal(deploymentParams.FUBI_SYMBOL);
      expect(await fUBI.ubi(),"lll").to.equal(ubi.address);

    });

    it("Should correctly mint flow when executing createFlow on UBI", async () => {

      // ARRANGE
      const sender = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await ubi.startAccruing(sender.address)

      // ACT
      await ubi.connect(accounts[1]).createFlow(accounts[2].address, 10000);

      // // ASSERT
      expect((await fUBI.balanceOf(accounts[2].address)).toNumber()).to.equal(1);
    });

    
    it("require fail - Creating flow of UBI per second higher than UBI.accruedPerSecond should fail.", async () => {
      // ARRANGE
      const sender = accounts[0];
      const recipient = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await pohMockService.setSubmissionIsRegistered(mockPoh, recipient.address, false);
      await ubi.startAccruing(sender.address);

      // Get the value of accruedPerSecond
      const accruedPerSecond = await ubi.accruedPerSecond();

      // Generate invalid payment per second
      const newFlowPaymentPerSecond = accruedPerSecond.add(1);

      // ACT && ASSERT
      // try to create flow with a value greater than accruedPerSecond, should revert
      await expect(testUtils.createFlow(sender,
        recipient.address,
        newFlowPaymentPerSecond,
        ubi, fUBI)).to.be.revertedWith("Cannot delegate a value higher than accruedPerSecond");;


    });

    it("require fail - Creating a flow from a non registered account should fail.", async () => {
      // ARRANGE
      const sender = accounts[0];
      const recipient = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, false);
      await pohMockService.setSubmissionIsRegistered(mockPoh, recipient.address, false);


      // ACT && ASSERT
      // try to create flow with a value greater than accruedPerSecond, should revert
      await expect(testUtils.createFlow(sender,
        recipient.address,
        100,
        ubi, fUBI))
        .to.be.revertedWith("Only registered humans accruing UBI can flow UBI.");

    });

    it("require fail - Creating a flow from a registered account NOT accruing UBI should fail.", async () => {
      // ARRANGE
      const sender = accounts[0];
      const recipient = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await pohMockService.setSubmissionIsRegistered(mockPoh, recipient.address, false);

      // ACT && ASSERT
      // try to create flow with a value greater than accruedPerSecond, should revert
      await expect(testUtils.createFlow(sender,
        recipient.address,
        100,
        ubi, fUBI))
        .to.be.revertedWith("Only registered humans accruing UBI can flow UBI.");
    });

    it("require fail - Creating a flow from a non registerded human should fail", async () => {
      // ARRANGE
      const sender = accounts[0];
      const recipient = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, false);
      await pohMockService.setSubmissionIsRegistered(mockPoh, recipient.address, false);

      await expect(testUtils.createFlow(
        sender,
        recipient.address,
        accruedPerSecond.toNumber(),
        ubi, fUBI)).to.be.revertedWith("Only registered humans accruing UBI can flow UBI.");
    })

    it("happy path - Creating a new flow after one has been canceled should not increment the number of active flows", async () => {
      // ARRANGE
      
      const sender = accounts[0];
      const recipient = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await pohMockService.setSubmissionIsRegistered(mockPoh, recipient.address, false);
      await ubi.startAccruing(sender.address);
      await testUtils.timeForward(3600, network);

      const flow1Id = await testUtils.createFlow(
        sender,
        recipient.address,
        accruedPerSecond.toNumber(),
        ubi, fUBI);
        

      // Get the previous flow count
      const prevFlowsCount = await fUBI.getFlowsCount(sender.address);


      
      await testUtils.timeForward(3600, network);
      // Delegate half of UBI per second
      const delegatedPerSecond = accruedPerSecond.div(2).toNumber();
      
      await ubi.cancelFlow(flow1Id);
      
      
      // Create flow with half ubiPerSecond delegation
      const flow2Id = await testUtils.createFlow(
        sender,
        recipient.address,
        delegatedPerSecond,
        ubi, fUBI);
      const currFlowsCount = await fUBI.getFlowsCount(sender.address);

      expect(prevFlowsCount.toString()).to.eq(ethers.BigNumber.from(1).toString(), "first flow should be number 1");
      expect(currFlowsCount.toString()).to.eq(prevFlowsCount.toString(), "Creating a flow after another has been canceled should not increase flow count");

    });

    it("happy path - Creating a new flow after one has not been canceled should increment the number of active flows", async () => {
      const sender = accounts[0];
      const recipient = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await pohMockService.setSubmissionIsRegistered(mockPoh, recipient.address, false);
      await ubi.startAccruing(sender.address);
      await testUtils.timeForward(3600, network);

      const delegatedPerSecond1 = accruedPerSecond.div(4).toNumber();

      const flow1Id = await testUtils.createFlow(
        sender,
        recipient.address,
        delegatedPerSecond1,
        ubi, fUBI);
        

      // Get the previous flow count
      const prevFlowsCount = await fUBI.getFlowsCount(sender.address);
      
      await testUtils.timeForward(3600, network);
      // Delegate half of UBI per second
      const delegatedPerSecond = accruedPerSecond.div(2).toNumber();
      
      
      // Create flow with half ubiPerSecond delegation
      const flow2Id = await testUtils.createFlow(
        sender,
        recipient.address,
        delegatedPerSecond,
        ubi, fUBI);
      const currFlowsCount = await fUBI.getFlowsCount(sender.address);
      expect(currFlowsCount.toNumber()).to.eq(prevFlowsCount.add(1).toNumber(), "Creating a new flow after one has not been canceled should increment the number of active flows");
    });

    it("require fail - Creating flow of UBI per second higher than UBI available should fail. just flows", async () => {
      // ARRANGE
      const sender = accounts[0];
      const recipient = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await pohMockService.setSubmissionIsRegistered(mockPoh, recipient.address, false);
      await ubi.startAccruing(sender.address);
      // Get the value of accruedPerSecond
      const accruedPerSecond = await ubi.accruedPerSecond();

      // Generate invalid payment per second
      const newFlowPaymentPerSecond = accruedPerSecond.div(2);

      // ACT && ASSERT
      // try to create flow with a value greater than available, should revert

      await testUtils.createFlow(sender,
        recipient.address,
        newFlowPaymentPerSecond.add(1),
        ubi, fUBI);

      await expect(testUtils.createFlow(sender,
        recipient.address,
        newFlowPaymentPerSecond,
        ubi, fUBI)).to.be.revertedWith("Delegated value exceeds available balance for the given Flow");


    });
    
    it("require fail - Creating flow of UBI per second higher than UBI available should fail. 1 stream", async () => {
      // ARRANGE
      const sender = accounts[0];
      const recipient = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await pohMockService.setSubmissionIsRegistered(mockPoh, recipient.address, false);
      await ubi.startAccruing(sender.address);

      // Get current block time
      const initialBlockTime = await testUtils.getCurrentBlockTime();

      // Get the value of accruedPerSecond
      const accruedPerSecond = await ubi.accruedPerSecond();

      // Generate invalid payment per second
      const newFlowPaymentPerSecond = accruedPerSecond.div(2);
      const currentBlockTime = await testUtils.getCurrentBlockTime();
      const fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
      const toDate = moment(fromDate).add(1, "hour").toDate();
      // ACT && ASSERT
      // try to create flow with a value greater than available, should revert
      await testUtils.createCancellableStream(
        sender,
        recipient.address,
        newFlowPaymentPerSecond.add(1),
        fromDate, toDate,
        ubi, sUBI);

      await expect(testUtils.createFlow(sender,
        recipient.address,
        newFlowPaymentPerSecond,
        ubi, fUBI)).to.be.revertedWith("Delegated value exceeds available balance for the given Flow");


    });

    it("require fail - Creating flow of UBI per second higher than UBI available should fail. 2 overlaping streams and 1 flow", async () => {
      // ARRANGE
      const sender = accounts[0];
      const recipient = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await pohMockService.setSubmissionIsRegistered(mockPoh, recipient.address, false);
      await ubi.startAccruing(sender.address);

      // Get the value of accruedPerSecond
      const accruedPerSecond = await ubi.accruedPerSecond();

      // Generate invalid payment per second
      const newFlowPaymentPerSecond = accruedPerSecond.div(5);
      const currentBlockTime = await testUtils.getCurrentBlockTime();
      // Different date but they overlap.
      const fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
      const toDate = moment(fromDate).add(1, "hour").toDate();

      const fromDate1 = moment(fromDate).add(3500, "seconds").toDate();
      const toDate1 = moment(fromDate1).add(1, "hour").toDate();


      // ACT && ASSERT
      // try to create flow with a value greater than available, should revert
      await testUtils.createCancellableStream(
        sender,
        recipient.address,
        newFlowPaymentPerSecond,
        fromDate, toDate,
        ubi, sUBI);

      await testUtils.createCancellableStream(
        sender,
        recipient.address,
        newFlowPaymentPerSecond,
        fromDate1, toDate1,
        ubi, sUBI);

      await testUtils.createFlow(sender,
        recipient.address,
        newFlowPaymentPerSecond,
        ubi, fUBI);

      await expect(testUtils.createFlow(sender,
        recipient.address,
        newFlowPaymentPerSecond.mul(3),
        ubi, fUBI)).to.be.revertedWith("Delegated value exceeds available balance for the given Flow");


    });

    it("require fail - Creating flow of UBI per second higher than UBI available should fail. 2 not overlaping streams and 1 flow", async () => {
      // ARRANGE
      const sender = accounts[0];
      const recipient = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await pohMockService.setSubmissionIsRegistered(mockPoh, recipient.address, false);
      await ubi.startAccruing(sender.address);

      // Get current block time
      const initialBlockTime = await testUtils.getCurrentBlockTime();

      // Get the value of accruedPerSecond
      const accruedPerSecond = await ubi.accruedPerSecond();

      // Generate invalid payment per second
      const newFlowPaymentPerSecond = accruedPerSecond.div(5);
      const currentBlockTime = await testUtils.getCurrentBlockTime();
      // Different date, they dont overlap.
      const fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
      const toDate = moment(fromDate).add(1, "hour").toDate();

      const fromDate1 = moment(fromDate).add(3601, "seconds").toDate();
      const toDate1 = moment(fromDate1).add(1, "hour").toDate();


      // ACT && ASSERT
      // try to create flow with a value greater than available, should revert
      await testUtils.createCancellableStream(
        sender,
        recipient.address,
        newFlowPaymentPerSecond,
        fromDate, toDate,
        ubi, sUBI);

      await testUtils.createCancellableStream(
        sender,
        recipient.address,
        newFlowPaymentPerSecond,
        fromDate1, toDate1,
        ubi, sUBI);

      await testUtils.createFlow(sender,
        recipient.address,
        newFlowPaymentPerSecond,
        ubi, fUBI);

      await expect(testUtils.createFlow(sender,
        recipient.address,
        newFlowPaymentPerSecond.mul(3),
        ubi, fUBI)).to.be.revertedWith("Delegated value exceeds available balance for the given Flow");


    });

    it("require fail - Recipient of flow can transfer UBI by just calling transfer", async () => {
      // ARRANGE
      const sender = accounts[0];
      const recipient = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await pohMockService.setSubmissionIsRegistered(mockPoh, recipient.address, false);
      await ubi.startAccruing(sender.address);

      // Get the value of accruedPerSecond
      const accruedPerSecond = await ubi.accruedPerSecond();

      // Generate invalid payment per second
      const newFlowPaymentPerSecond = accruedPerSecond;


      // ACT && ASSERT
      // try to create flow with a value greater than available, should revert

      await testUtils.createFlow(sender,
        recipient.address,
        newFlowPaymentPerSecond,
        ubi, fUBI);

      await testUtils.timeForward(3600, network);

      await expect(await ubi.balanceOf(recipient.address)).to.eq(await ethers.BigNumber.from(newFlowPaymentPerSecond.mul(3600)));

      await ubi.connect(recipient).transfer(accounts[2].address, ethers.utils.parseUnits("1.008", 18));
        
      await expect(await ubi.balanceOf(accounts[2].address)).to.eq(await ethers.BigNumber.from(newFlowPaymentPerSecond.mul(3600)));


    });

  });
});