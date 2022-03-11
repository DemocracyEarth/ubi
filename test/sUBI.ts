import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, upgrades, network } from "hardhat";
import moment from "moment";
const testUtils = require("./testUtils");
const pohMockService = require("./utils/pohMockService");
const ubiMockService = require("./utils/ubiMockService");
const deploymentParams = require('../deployment-params');

async function deploySUBI(ubiInstance) {
  const SUBIFactory = await ethers.getContractFactory("sUBI");
  const sUBI = await SUBIFactory.deploy(ubiInstance.address, deploymentParams.SUBI_MAX_STREAMS_ALLOWED, deploymentParams.SUBI_NAME, deploymentParams.SUBI_SYMBOL);
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

describe("sUBI.sol", () => {

  let ubi;
  let mockUBI;
  let mockPoh;
  let accounts: SignerWithAddress[];
  beforeEach(async () => {

    // Get signers
    accounts = await ethers.getSigners();

    mockPoh = await pohMockService.deployMock(accounts[0]);

    // Deploy mock UBI
    mockUBI = await ubiMockService.deployMockUBI(accounts[0], mockPoh);
    ubi = await deployUBI(mockPoh.address);
  })

  describe("accruedTime related tests", () => {

    it("Should correctly set contract initial parameters on deployment", async () => {
      // ARRANGE
      const SUBIFactory = await ethers.getContractFactory("sUBI");

      // ACT
      const sUBI = await SUBIFactory.deploy(mockUBI.address, deploymentParams.SUBI_MAX_STREAMS_ALLOWED, deploymentParams.SUBI_NAME, deploymentParams.SUBI_SYMBOL);
      await sUBI.deployed();


      // ASSERT
      expect(await sUBI.name()).to.equal(deploymentParams.SUBI_NAME);
      expect(await sUBI.symbol()).to.equal(deploymentParams.SUBI_SYMBOL);
      expect((await sUBI.maxStreamsAllowed()).toNumber()).to.equal(deploymentParams.SUBI_MAX_STREAMS_ALLOWED);
      expect((await sUBI.ubi())).to.equal(mockUBI.address);

    });

    it("Should correctly mint stream when executing createStream on UBI", async () => {

      // ARRANGE
      const sUBI = await deploySUBI(ubi);
      const sender = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await ubi.startAccruing(sender.address)

      const currentBlockTime = await testUtils.getCurrentBlockTime();
      const dateFrom = currentBlockTime + 10;
      const dateTo = dateFrom + 20;

      // ACT
      await ubi.connect(accounts[1]).createStream(accounts[2].address, 10000, dateFrom, dateTo);

      // // ASSERT
      expect((await sUBI.balanceOf(accounts[2].address)).toNumber()).to.equal(1);
    });

    it("happy path - after creating a stream, accruedTime should return 0 if stream didnt start", async () => {
      // ARRANGE
      const sUBI = await deploySUBI(ubi);
      const sender = accounts[0];
      const recipient = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await pohMockService.setSubmissionIsRegistered(mockPoh, recipient.address, false);
      await ubi.startAccruing(sender.address)

      // Get current block time
      const initialBlockTime = await testUtils.getCurrentBlockTime();
      // Stream start 1 hour from now
      const fromDate = moment(new Date(initialBlockTime * 1000)).add(1, "hours").toDate();
      // Stream lasts 1 hour
      const toDate = moment(fromDate).add(1, "hour").toDate();

      // ACT
      // Create stream
      const lastStreamId = await testUtils.createStream(sender,
        recipient.address,
        100,
        fromDate,
        toDate,
        ubi, sUBI);

      // ASSERT 
      // Check that delta of return 0 (because stream didnt start). 
      expect((await sUBI.accruedTime(lastStreamId.toNumber())).toNumber()).to.eq(0);
    })

    it("happy path - after moving to middle of stream, accruedTime should return 1800", async () => {

      // ARRANGE
      const sUBI = await deploySUBI(ubi);
      const sender = accounts[0];
      const recipient = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await pohMockService.setSubmissionIsRegistered(mockPoh, recipient.address, false);
      await ubi.startAccruing(sender.address)

      // Get current block time
      const initialBlockTime = await testUtils.getCurrentBlockTime();
      // Stream start 1 hour from now
      const fromDate = moment(new Date(initialBlockTime * 1000)).add(1, "hours").toDate();
      // Stream lasts 1 hour
      const toDate = moment(fromDate).add(1, "hour").toDate();
      // Create stream
      const lastStreamId = await testUtils.createStream(sender,
        recipient.address,
        100,
        fromDate,
        toDate,
        ubi, sUBI);

      // ACT
      // Set block time to middle of stream,
      await testUtils.goToMiddleOfStream(lastStreamId, sUBI, network);

      // ASSERT 
      // Check that accruedTime of returns 1800.
      expect((await sUBI.accruedTime(lastStreamId)).toNumber()).to.eq(1800);
    })

    it("happy path - after stream is finished, deltaOf should return the 3600 seconds.", async () => {

      // ARRANGE
      const sUBI = await deploySUBI(ubi);
      const sender = accounts[0];
      const recipient = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await pohMockService.setSubmissionIsRegistered(mockPoh, recipient.address, false);
      await ubi.startAccruing(sender.address)

      // Get current block time
      const initialBlockTime = await testUtils.getCurrentBlockTime();
      // Stream start 1 hour from now
      const fromDate = moment(new Date(initialBlockTime * 1000)).add(1, "hours").toDate();
      // Stream lasts 1 hour
      const toDate = moment(fromDate).add(1, "hour").toDate();
      // Create stream
      const lastStreamId = await testUtils.createStream(sender,
        recipient.address,
        100,
        fromDate,
        toDate,
        ubi, sUBI);

      // ARRANGE & ACT                
      // Set block time to startTime + 200
      await testUtils.goToEndOfStream(lastStreamId, sUBI, network);

      // ASSERT 
      // Check that accruedTime returns 3600
      expect((await sUBI.accruedTime(lastStreamId)).toNumber()).to.eq(3600);
    })

    it("happy path - after creating a stream, moving to the middle of the stream, and withdrawing accruedTime should return 0 because all available accrued time was withdrawn", async () => {
      // ARRANGE
      const sUBI = await deploySUBI(ubi);
      const sender = accounts[0];
      const recipient = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await pohMockService.setSubmissionIsRegistered(mockPoh, recipient.address, false);
      await ubi.startAccruing(sender.address)

      // Get current block time
      const initialBlockTime = await testUtils.getCurrentBlockTime();
      // Stream start 1 hour from now
      const fromDate = moment(new Date(initialBlockTime * 1000)).add(1, "hours").toDate();
      // Stream lasts 1 hour
      const toDate = moment(fromDate).add(1, "hour").toDate();
      // Create stream
      const lastStreamId = await testUtils.createStream(sender,
        recipient.address,
        100,
        fromDate,
        toDate,
        ubi, sUBI);

      // ACT
      // move to middle of stream
      await testUtils.goToMiddleOfStream(lastStreamId, sUBI, network);
      // widthdraw from stream
      await ubi.withdrawFromStream(lastStreamId);

      // ASSERT 
      // Check that accruedTime returns 0. 
      expect((await sUBI.accruedTime(lastStreamId)).toNumber()).to.eq(0);
    })

    it("happy path - after withdrawing from the middle of stream and moving to the end, accruedTime should return 1799 seconds.", async () => {
      // ARRANGE
      const sUBI = await deploySUBI(ubi);
      const sender = accounts[0];
      const recipient = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await pohMockService.setSubmissionIsRegistered(mockPoh, recipient.address, false);
      await ubi.startAccruing(sender.address)

      // Get current block time
      const initialBlockTime = await testUtils.getCurrentBlockTime();
      // Stream start 1 hour from now
      const fromDate = moment(new Date(initialBlockTime * 1000)).add(1, "hours").toDate();
      // Stream lasts 1 hour
      const toDate = moment(fromDate).add(1, "hour").toDate();
      // Create stream
      const lastStreamId = await testUtils.createStream(sender,
        recipient.address,
        100,
        fromDate,
        toDate,
        ubi, sUBI);

      // ACT
      // move to middle of stream
      await testUtils.goToMiddleOfStream(lastStreamId, sUBI, network);
      // widthdraw from stream
      await ubi.withdrawFromStream(lastStreamId);
      // Set block time to end of stream
      await testUtils.goToEndOfStream(lastStreamId, sUBI, network);

      // ASSERT 
      // Check that accruedTime returns 1799
      // NOTE: Expected value is not 1800 because balance was withdrawn in the middle of stream and block time was moved 1 second when executing withdrawFromStream.                
      expect((await sUBI.accruedTime(lastStreamId)).toNumber()).to.eq(1799);
    })

    it("happy path - after moving to the end of stream, withdrawning balance, accruedTime should return 0 seconds.", async () => {                // ARRANGE & ACT                
      // ARRANGE
      const sUBI = await deploySUBI(ubi);
      const sender = accounts[0];
      const recipient = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await pohMockService.setSubmissionIsRegistered(mockPoh, recipient.address, false);
      await ubi.startAccruing(sender.address)

      // Get current block time
      const initialBlockTime = await testUtils.getCurrentBlockTime();
      // Stream start 1 hour from now
      const fromDate = moment(new Date(initialBlockTime * 1000)).add(1, "hours").toDate();
      // Stream lasts 1 hour
      const toDate = moment(fromDate).add(1, "hour").toDate();
      // Create stream
      const lastStreamId = await testUtils.createStream(sender,
        recipient.address,
        100,
        fromDate,
        toDate,
        ubi, sUBI);

      // ACT
      // Set block time to end of stream
      await testUtils.goToEndOfStream(lastStreamId, sUBI, network);
      // widthdraw from stream
      await ubi.withdrawFromStream(lastStreamId);

      // ASSERT 
      // deltaOf should return 0.
      expect((await sUBI.accruedTime(lastStreamId)).toNumber()).to.eq(0);
    });
  });

  it("fail path - Executing onWithdrawnFromStream from user should fail", async () => {
    // ARRANGE
    const sUBI = await deploySUBI(ubi);
    const sender = accounts[0];
    const recipient = accounts[1];
    await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
    await pohMockService.setSubmissionIsRegistered(mockPoh, recipient.address, false);
    await ubi.startAccruing(sender.address)

    // Get current block time
    const initialBlockTime = await testUtils.getCurrentBlockTime();
    // Stream start 1 hour from now
    const fromDate = moment(new Date(initialBlockTime * 1000)).add(1, "hours").toDate();
    // Stream lasts 1 hour
    const toDate = moment(fromDate).add(1, "hour").toDate();
    // Create stream
    const lastStreamId = await testUtils.createStream(sender,
      recipient.address,
      100,
      fromDate,
      toDate,
      ubi, sUBI);

    // ACT & ASSERT
    // move to middle of stream
    await testUtils.goToMiddleOfStream(lastStreamId, sUBI, network);
    // execute onWidthdraw from stream should fail
    await expect(sUBI.onWithdrawnFromStream(lastStreamId)).to.be.revertedWith("caller is not UBI contract");
  })
});
