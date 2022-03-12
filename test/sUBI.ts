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
  })

  describe("Basic tests", () => {
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

    it("require fail - Creating stream of UBI per second higher than UBI.accruedPerSecond should fail.", async () => {
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

      // Get the value of accruedPerSecond
      const accruedPerSecond = await ubi.accruedPerSecond();

      // Generate invalid payment per second
      const newStreamPaymentPerSecond = accruedPerSecond.add(1);

      // ACT && ASSERT
      // try to create stream with a value greater than accruedPerSecond, should revert
      await expect(testUtils.createStream(sender,
        recipient.address,
        newStreamPaymentPerSecond,
        fromDate,
        toDate,
        ubi, sUBI)).to.be.revertedWith("Cannot delegate a value higher than accruedPerSecond");;


    });

    it("require fail - Creating a stream from a non registered account should fail.", async () => {
      // ARRANGE
      const sUBI = await deploySUBI(ubi);
      const sender = accounts[0];
      const recipient = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, false);
      await pohMockService.setSubmissionIsRegistered(mockPoh, recipient.address, false);

      // Get current block time
      const currentBlockTime = await testUtils.getCurrentBlockTime();
      const fromDate = moment(new Date(currentBlockTime * 1000)).add(10, "minutes").toDate();
      const toDate = moment(fromDate).add(1, "hour").toDate();

      // ACT && ASSERT
      // try to create stream with a value greater than accruedPerSecond, should revert
      await expect(testUtils.createStream(sender,
        recipient.address,
        100,
        fromDate,
        toDate,
        ubi, sUBI))
        .to.be.revertedWith("Only registered humans accruing UBI can stream UBI.");

    });

    it("require fail - Creating a stream from a registered account NOT accruing UBI should fail.", async () => {
      // ARRANGE
      const sUBI = await deploySUBI(ubi);
      const sender = accounts[0];
      const recipient = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await pohMockService.setSubmissionIsRegistered(mockPoh, recipient.address, false);

      // Get current block time
      const currentBlockTime = await testUtils.getCurrentBlockTime();
      const fromDate = moment(new Date(currentBlockTime * 1000)).add(10, "minutes").toDate();
      const toDate = moment(fromDate).add(1, "hour").toDate();

      // ACT && ASSERT
      // try to create stream with a value greater than accruedPerSecond, should revert
      await expect(testUtils.createStream(sender,
        recipient.address,
        100,
        fromDate,
        toDate,
        ubi, sUBI))
        .to.be.revertedWith("Only registered humans accruing UBI can stream UBI.");
    });

    it("happy path - After creating a stream with full accrual that starts in the future, human should accrue UBI until stream starts.", async () => {
      const sUBI = await deploySUBI(ubi);
      const sender = accounts[0];
      const recipient = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await pohMockService.setSubmissionIsRegistered(mockPoh, recipient.address, false);
      await ubi.startAccruing(sender.address)

      const initialBlockTime = await testUtils.getCurrentBlockTime();
      // Stream starts at current blocktime + 1 hour
      const fromDate = moment(new Date(initialBlockTime * 1000)).add(1, "hours").toDate();
      // Stream lasts 1 hour
      const toDate = moment(fromDate).add(1, "hour").toDate();

      // CReate stream
      const lastStreamId = await testUtils.createStream(
        sender,
        recipient.address,
        accruedPerSecond.toNumber(),
        fromDate, toDate,
        ubi, sUBI);

      const blockTimeAfterStreamCreation = await testUtils.getCurrentBlockTime();

      // Get previous human balance 
      const prevHumanBalance = await ubi.balanceOf(sender.address);

      // Get previous Stream balance
      const prevStreamBalance = await sUBI.balanceOfStream(lastStreamId);
      expect(prevStreamBalance.toNumber()).to.eq(0, "Initial stream balance should be 0");

      // Move blocktime to the start of the stream
      await testUtils.goToStartOfStream(lastStreamId, sUBI, network);

      const streamStartBlockTime = await testUtils.getCurrentBlockTime();

      // Get current human balance 
      const currHumanBalance = await ubi.balanceOf(sender.address);
      expect(currHumanBalance.toString()).to.eq(prevHumanBalance.add(accruedPerSecond.mul(streamStartBlockTime - blockTimeAfterStreamCreation)).toString(), "Human balance ");

      const currentStreamBalance = await sUBI.balanceOfStream(lastStreamId);
      expect(currentStreamBalance.toNumber()).to.eq(0, "Current stream balance should still be 0");
    });

    it("happy path - After recipient withdraws from finished stream, human balance should be correctly accrued.", async () => {
      // ARRANGE
      const sUBI = await deploySUBI(ubi);
      const sender = accounts[0];
      const recipient = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await pohMockService.setSubmissionIsRegistered(mockPoh, recipient.address, false);
      await ubi.startAccruing(sender.address)

      const initialBlockTime = await testUtils.getCurrentBlockTime();
      // Stream starts at current blocktime + 1 hour
      const fromDate = moment(new Date(initialBlockTime * 1000)).add(1, "hours").toDate();
      // Stream lasts 1 hour
      const toDate = moment(fromDate).add(1, "hour").toDate();

      // CReate stream
      const lastStreamId = await testUtils.createStream(
        sender,
        recipient.address,
        accruedPerSecond.toNumber(),
        fromDate, toDate,
        ubi, sUBI);

      // Get previous Stream balance
      const prevStreamBalance = await sUBI.balanceOfStream(lastStreamId);
      expect(prevStreamBalance.toNumber()).to.eq(0, "Initial stream balance should be 0");

      // Move blocktime to the start of the stream
      await testUtils.goToEndOfStream(lastStreamId, sUBI, network);


      // Recipient withdraws balance
      await ubi.connect(accounts[1]).withdrawFromStream(lastStreamId);

      // Trying to get balance, stream should not exist
      expect((await sUBI.balanceOfStream(lastStreamId)).toNumber()).to.eq(0, "Stream balance should be 0");

      // Get current human balance 
      const prevSenderSnapshot = {
        balance: await ubi.balanceOf(sender.address),
        timestamp: await testUtils.getCurrentBlockTime()
      };

      // Move forward  one hour
      await testUtils.timeForward(3600, network);


      // Get current human balance 
      const currSenderSnapshot = {
        balance: await ubi.balanceOf(sender.address),
        timestamp: await testUtils.getCurrentBlockTime()
      };

      expect(currSenderSnapshot.balance.toString()).to.eq(prevSenderSnapshot.balance.add(accruedPerSecond.mul(currSenderSnapshot.timestamp - prevSenderSnapshot.timestamp)).toString(), "Invalid sender balance after finished stream was withdrawn");

    });

    it("happy path - When human stops being registered, stream should stop accruing.", async () => {
      // ARRANGE
      const sUBI = await deploySUBI(ubi);
      const sender = accounts[0];
      const recipient = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await pohMockService.setSubmissionIsRegistered(mockPoh, recipient.address, false);
      await ubi.startAccruing(sender.address);

      // Create stream 1 minute after current blockTime
      const currentBlockTime = await testUtils.getCurrentBlockTime();
      const fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
      const toDate = moment(fromDate).add(1, "hour").toDate();

      // CReate stream
      const lastStreamId = await testUtils.createStream(
        sender,
        recipient.address,
        accruedPerSecond.toNumber(),
        fromDate, toDate,
        ubi, sUBI);

      // Move to end of stream
      await testUtils.goToEndOfStream(lastStreamId, sUBI, network);

      // Unregister human
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, false);

      // GetStream balance
      const streamBalance = await sUBI.balanceOfStream(lastStreamId);
      expect(streamBalance.toNumber()).to.eq(0, "Stream should not accrue if human is not registered");
    });

    it("require fail - Creating a stream from a non registerded human should fail", async () => {
      // ARRANGE
      const sUBI = await deploySUBI(ubi);
      const sender = accounts[0];
      const recipient = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, false);
      await pohMockService.setSubmissionIsRegistered(mockPoh, recipient.address, false);

      // Create stream 1 minute after current blockTime
      const currentBlockTime = await testUtils.getCurrentBlockTime();
      const fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
      const toDate = moment(fromDate).add(1, "hour").toDate();

      await expect(testUtils.createStream(
        sender,
        recipient.address,
        accruedPerSecond.toNumber(),
        fromDate, toDate,
        ubi, sUBI)).to.be.revertedWith("Only registered humans accruing UBI can stream UBI.");
    })
  })

  describe("accruedTime related tests", () => {

    let sUBI;
    beforeEach(async () => {
      sUBI = await deploySUBI(ubi);
    })

    it("happy path - after creating a stream, accruedTime should return 0 if stream didnt start", async () => {
      // ARRANGE
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

    it("happy path - While stream with full accruedPerSecond delegation is active, human should not accrue any UBI and stream should accrue.", async () => {
      const sender = accounts[0];
      const recipient = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await pohMockService.setSubmissionIsRegistered(mockPoh, recipient.address, false);
      await ubi.startAccruing(sender.address)

      // NEW STREAM
      const initialBlockTime = await testUtils.getCurrentBlockTime();
      // Stream starts at current blocktime + 1 hour
      const fromDate = moment(new Date(initialBlockTime * 1000)).add(1, "hours").toDate();
      // Stream lasts 2 hours
      const toDate = moment(fromDate).add(1, "hour").toDate();

      // Create a new stream delegating all ubiPerSecond
      const lastStreamId = await testUtils.createStream(sender, recipient.address, accruedPerSecond.toNumber(), fromDate, toDate, ubi, sUBI);
      const stream = await sUBI.getStream(lastStreamId);

      // Move blocktime to the start of the stream
      await testUtils.goToStartOfStream(lastStreamId, sUBI, network);

      // Get previous human balance 
      const prevHumanBalance = await ubi.balanceOf(sender.address);
      // Get previous Stream balance
      const prevStreamBalance = await sUBI.balanceOfStream(lastStreamId);

      // Move block time to the end of the stream
      await testUtils.goToEndOfStream(lastStreamId, sUBI, network);

      const streamTotalTime = stream.stopTime.toNumber() - stream.startTime.toNumber();

      // Get current human balance 
      const currHumanBalance = await ubi.balanceOf(sender.address);
      // Get current Stream balance
      const currStreamBalance = await sUBI.balanceOfStream(lastStreamId);

      // Human should have not accrued the balance of 1 hour
      expect(currHumanBalance.toString()).to.eq(prevHumanBalance.toString(), "Human should not increase balance after delegating all UBIs per second");
      // Stream should have accrued the balance of 1 hour
      expect(currStreamBalance.toString()).to.eq(prevStreamBalance.add(stream.ratePerSecond.mul(streamTotalTime)).toString(), "Stream should increase the balance in 1 UBI");
    });
  });

  describe("getDelegatedAccruedValue", () => {

    let sUBI;
    beforeEach(async () => {
      sUBI = await deploySUBI(ubi);
    })

    describe("getDelegatedAccruedValue with single delegation", () => {


      describe("getDelegatedAccruedValue without withdrawal", () => {


        it("happy path - after creating a stream that didnt start, getDelegatedAccruedValue should return 0 UBIwei", async () => {
          // ARRANGE
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
          await testUtils.createStream(sender, recipient.address, 100, fromDate, toDate, ubi, sUBI);

          // ASSERT 
          // Check that delegated accrued value returns 0 (because stream didnt start). 
          expect((await sUBI.getDelegatedAccruedValue(sender.address)).toNumber()).to.eq(0);
        })

        it("happy path - after moving to middle of stream, getDelegatedValue should return 180000 UBIwei", async () => {

          // ARRANGE
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
          const lastStreamId = await testUtils.createStream(sender, recipient.address, 100, fromDate, toDate, ubi, sUBI);

          // ACT
          // Set block time to middle of stream
          await testUtils.goToMiddleOfStream(lastStreamId, sUBI, network);

          // ASSERT 
          // Check that delegated accrued value returns 180000.
          expect((await sUBI.getDelegatedAccruedValue(sender.address)).toNumber()).to.eq(180000);
        })

        it("happy path - after stream is finished, getDelegatedAccruedValue should return the 360000 UBIwei.", async () => {

          // ARRANGE
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
          const lastStreamId = await testUtils.createStream(sender, recipient.address, 100, fromDate, toDate, ubi, sUBI);

          // ACT
          // Set block time to startTime + 200
          await testUtils.goToEndOfStream(lastStreamId, sUBI, network);

          // ASSERT 
          // Check that delta of returns 200.
          expect((await sUBI.getDelegatedAccruedValue(sender.address)).toNumber()).to.eq(360000);
        })
      })

      describe("getDelegatedAccruedValue with withdrawal", () => {

        it("happy path - after creating a stream, moving to the middle of stream and witrhdrawing, getDelegatedAccruedValue should return 0 UBIwei because pending balance was withdrawn", async () => {
          // ARRANGE
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
          const lastStreamId = await testUtils.createStream(sender, recipient.address, 100, fromDate, toDate, ubi, sUBI);
          // move to middle of stream
          await testUtils.goToMiddleOfStream(lastStreamId, sUBI, network);

          // ACT
          // widthdraw from stream
          await ubi.withdrawFromStream(lastStreamId);

          // ASSERT 
          // Check that getDelegatedAccruedValue of returns 0.
          expect((await sUBI.getDelegatedAccruedValue(sender.address)).toNumber()).to.eq(0);
        })

        it("happy path - creating a stream, withdrawing at the middle and after stream is finished, getDelegatedAccruedValue should return the 179900 UBIwei.", async () => {
          // ARRANGE
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
          const lastStreamId = await testUtils.createStream(sender, recipient.address, 100, fromDate, toDate, ubi, sUBI);
          // move to middle of stream
          await testUtils.goToMiddleOfStream(lastStreamId, sUBI, network);
          // widthdraw from stream
          await ubi.withdrawFromStream(lastStreamId);

          // ACT           
          // Go to end of stream,
          await testUtils.goToEndOfStream(lastStreamId, sUBI, network);

          // ASSERT 
          // Check that getDelegatedAccruedValue return 179900 (because withdraw from stream moves 1 secon further).
          expect((await sUBI.getDelegatedAccruedValue(sender.address)).toNumber()).to.eq(179900);
        })

        it("happy path - after stream is finished, and balance is withdrawn, getDelegatedAccruedValue should return the 0 UBIwei.", async () => {
          // ARRANGE
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
          const lastStreamId = await testUtils.createStream(sender, recipient.address, 100, fromDate, toDate, ubi, sUBI);
          // move to middle of stream
          await testUtils.goToMiddleOfStream(lastStreamId, sUBI, network);

          // ACT           
          // Go to end of stream,
          await testUtils.goToEndOfStream(lastStreamId, sUBI, network);
          // widthdraw from stream
          await ubi.withdrawFromStream(lastStreamId);

          // ASSERT 
          // Check that getDelegatedAccruedValue return 179900 (because withdraw from stream moves 1 secon further).
          expect((await sUBI.getDelegatedAccruedValue(sender.address)).toNumber()).to.eq(0);
        })
      })
    })

    describe("getDelegatedAccruedValue with multiple overlapping delegations", () => {

      describe("getDelegatedAccruedValue without withdrawals", () => {

        it("happy path - creating 2 streams, with 30 minutes of difference, before any starts, getDelegatedAccruedValue should return 0 UBIwei", async () => {
          // ARRANGE
          const sender = accounts[0];
          const recipient1 = accounts[1];
          const recipient2 = accounts[2];
          await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
          await ubi.startAccruing(sender.address)

          // Get current block time
          const initialBlockTime = await testUtils.getCurrentBlockTime();
          // Streams start 1 hour from now
          const fromDate1 = moment(new Date(initialBlockTime * 1000)).add(1, "hours").toDate();
          const fromDate2 = moment(fromDate1).add(30, "minutes").toDate();
          // Streams lasts 1 hour
          const toDate1 = moment(fromDate1).add(1, "hour").toDate();
          const toDate2 = moment(fromDate2).add(1, "hour").toDate();

          // ACT
          // Create streams
          await testUtils.createStream(sender, recipient1.address, 100, fromDate1, toDate1, ubi, sUBI);
          await testUtils.createStream(sender, recipient2.address, 100, fromDate2, toDate2, ubi, sUBI);

          // ASSERT 
          // Check that delta of return 0 (because streams didnt start). 
          expect((await sUBI.getDelegatedAccruedValue(sender.address)).toNumber()).to.eq(0);
        })

        it("happy path - creating 2 streams with 30 mins difference, after moving to the middle of the 1st stream, getDelegatedAccruedValue should return 180000 UBIwei since the 2nd didnt started", async () => {
          // ARRANGE
          const sender = accounts[0];
          const recipient1 = accounts[1];
          const recipient2 = accounts[2];
          await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
          await ubi.startAccruing(sender.address)

          // Get current block time
          const initialBlockTime = await testUtils.getCurrentBlockTime();
          // Streams start 1 hour from now
          const fromDate1 = moment(new Date(initialBlockTime * 1000)).add(1, "hours").toDate();
          const fromDate2 = moment(fromDate1).add(30, "minutes").toDate();
          // Streams lasts 1 hour
          const toDate1 = moment(fromDate1).add(1, "hour").toDate();
          const toDate2 = moment(fromDate2).add(1, "hour").toDate();
          // Create streams
          const streamId1 = await testUtils.createStream(sender, recipient1.address, 100, fromDate1, toDate1, ubi, sUBI);
          await testUtils.createStream(sender, recipient2.address, 100, fromDate2, toDate2, ubi, sUBI);

          // ACT
          // ARRANGE / ACT
          // Set block time to middle of first stream
          await testUtils.goToMiddleOfStream(streamId1, sUBI, network);

          // ASSERT 
          // Check that getDelegatedAccruedValue returns 180000 UBIwei
          expect((await sUBI.getDelegatedAccruedValue(sender.address)).toNumber()).to.eq(180000);
        })

        it("happy path - creating 2 streams with 30 mins difference, after moving to the end of 1st stream, getDelegatedAccruedValue should return the 360000 + 180000 UBIwei (because the 2nd stream should be in the middle).", async () => {

          // ARRANGE
          const sender = accounts[0];
          const recipient1 = accounts[1];
          const recipient2 = accounts[2];
          await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
          await ubi.startAccruing(sender.address)

          // Get current block time
          const initialBlockTime = await testUtils.getCurrentBlockTime();
          // Streams start 1 hour from now
          const fromDate1 = moment(new Date(initialBlockTime * 1000)).add(1, "hours").toDate();
          const fromDate2 = moment(fromDate1).add(30, "minutes").toDate();
          // Streams lasts 1 hour
          const toDate1 = moment(fromDate1).add(1, "hour").toDate();
          const toDate2 = moment(fromDate2).add(1, "hour").toDate();
          // Create streams
          await testUtils.createStream(sender, recipient1.address, 100, fromDate1, toDate1, ubi, sUBI);
          const streamId2 = await testUtils.createStream(sender, recipient2.address, 100, fromDate2, toDate2, ubi, sUBI);

          // ACT
          // Set block time to end of second stream
          await testUtils.goToMiddleOfStream(streamId2, sUBI, network);

          // ASSERT 
          // Check that delta of returns 360000 + 180000.
          expect((await sUBI.getDelegatedAccruedValue(sender.address)).toNumber()).to.eq(360000 + 180000);
        })

        it("happy path - creating 2 streams with 30 mins difference, after moving to the end of 2nd stream, getDelegatedAccruedValue should return 360000 + 360000 UBIwei (because the 2nd stream should be in the middle).", async () => {
          // ARRANGE
          const sender = accounts[0];
          const recipient1 = accounts[1];
          const recipient2 = accounts[2];
          await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
          await ubi.startAccruing(sender.address)

          // Get current block time
          const initialBlockTime = await testUtils.getCurrentBlockTime();
          // Streams start 1 hour from now
          const fromDate1 = moment(new Date(initialBlockTime * 1000)).add(1, "hours").toDate();
          const fromDate2 = moment(fromDate1).add(30, "minutes").toDate();
          // Streams lasts 1 hour
          const toDate1 = moment(fromDate1).add(1, "hour").toDate();
          const toDate2 = moment(fromDate2).add(1, "hour").toDate();
          // Create streams
          await testUtils.createStream(sender, recipient1.address, 100, fromDate1, toDate1, ubi, sUBI);
          const streamId2 = await testUtils.createStream(sender, recipient2.address, 100, fromDate2, toDate2, ubi, sUBI);

          // ARRANGE & ACT                
          // Set block time to end of second stream
          await testUtils.goToEndOfStream(streamId2, sUBI, network);

          // ASSERT 
          // Check that delta of returns 360000 + 360000.
          expect((await sUBI.getDelegatedAccruedValue(sender.address)).toNumber()).to.eq(360000 + 360000);
        })
      })

      describe("getDelegatedAccruedValue with withdrawals", () => {

        it("happy path - creating 2 streams, with 30 minutes of difference, moving to middle of 1st and withdrawing, getDelegatedAccruedValue should return 100 UBIwei (because 1 second of withdrawn)", async () => {

          // ARRANGE
          const sender = accounts[0];
          const recipient1 = accounts[1];
          const recipient2 = accounts[2];
          await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
          await ubi.startAccruing(sender.address)

          // Get current block time
          const initialBlockTime = await testUtils.getCurrentBlockTime();
          // Streams start 1 hour from now
          const fromDate1 = moment(new Date(initialBlockTime * 1000)).add(1, "hours").toDate();
          const fromDate2 = moment(fromDate1).add(30, "minutes").toDate();
          // Streams lasts 1 hour
          const toDate1 = moment(fromDate1).add(1, "hour").toDate();
          const toDate2 = moment(fromDate2).add(1, "hour").toDate();
          // Create streams
          const streamId1 = await testUtils.createStream(sender, recipient1.address, 100, fromDate1, toDate1, ubi, sUBI);
          await testUtils.createStream(sender, recipient2.address, 100, fromDate2, toDate2, ubi, sUBI);

          // ACT
          // Move to middle of 1st stream
          await testUtils.goToMiddleOfStream(streamId1, sUBI, network);
          // Withdraw from 1st stream
          await ubi.withdrawFromStream(streamId1);

          // ASSERT 
          // getDelegatedAccruedValue should return 0
          expect((await sUBI.getDelegatedAccruedValue(sender.address)).toNumber()).to.eq(100);
        })


        it("happy path - creating 2 streams, with 30 minutes of difference, moving to middle of 1st and withdrawing, and then moving to the middle of stream 2, in which first stream is finished, getDelegatedAccruedValue should return 180000 + 179900 UBIwei.", async () => {
          // ARRANGE
          const sender = accounts[0];
          const recipient1 = accounts[1];
          const recipient2 = accounts[2];
          await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
          await ubi.startAccruing(sender.address)

          // Get current block time
          const initialBlockTime = await testUtils.getCurrentBlockTime();
          // Streams start 1 hour from now
          const fromDate1 = moment(new Date(initialBlockTime * 1000)).add(1, "hours").toDate();
          const fromDate2 = moment(fromDate1).add(30, "minutes").toDate();
          // Streams lasts 1 hour
          const toDate1 = moment(fromDate1).add(1, "hour").toDate();
          const toDate2 = moment(fromDate2).add(1, "hour").toDate();
          // Create streams
          const streamId1 = await testUtils.createStream(sender, recipient1.address, 100, fromDate1, toDate1, ubi, sUBI);
          const streamId2 = await testUtils.createStream(sender, recipient2.address, 100, fromDate2, toDate2, ubi, sUBI);

          // Move to middle of 1st stream
          await testUtils.goToMiddleOfStream(streamId1, sUBI, network);
          // Withdraw from 1st stream
          await ubi.withdrawFromStream(streamId1);


          // ACT         
          // Go to end of stream 2,
          await testUtils.goToMiddleOfStream(streamId2, sUBI, network);

          // ASSERT 
          // Check that getDelegatedAccruedValue returns 179900 + 180000 (because withdraw from stream moves 1 second further).
          expect((await sUBI.getDelegatedAccruedValue(sender.address)).toNumber()).to.eq(179900 + 180000);

        })

        it("happy path - creating 2 streams, with 30 minutes of difference, moving to the middle of stream 2, and withdrawing from stream 2, getDelegatedAccruedValue should return 360000 + 0 UBIwei.", async () => {

          // ARRANGE
          const sender = accounts[0];
          const recipient1 = accounts[1];
          const recipient2 = accounts[2];
          await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
          await ubi.startAccruing(sender.address)

          // Get current block time
          const initialBlockTime = await testUtils.getCurrentBlockTime();
          // Streams start 1 hour from now
          const fromDate1 = moment(new Date(initialBlockTime * 1000)).add(1, "hours").toDate();
          const fromDate2 = moment(fromDate1).add(30, "minutes").toDate();
          // Streams lasts 1 hour
          const toDate1 = moment(fromDate1).add(1, "hour").toDate();
          const toDate2 = moment(fromDate2).add(1, "hour").toDate();
          // Create streams
          const streamId1 = await testUtils.createStream(sender, recipient1.address, 100, fromDate1, toDate1, ubi, sUBI);
          const streamId2 = await testUtils.createStream(sender, recipient2.address, 100, fromDate2, toDate2, ubi, sUBI);

          // ACT                
          // Go to end of stream 2,
          await testUtils.goToMiddleOfStream(streamId2, sUBI, network);
          // Withdraw from stream 2
          await ubi.withdrawFromStream(streamId2);

          // ASSERT 
          // Check that getDelegatedAccruedValue returns 179900 + 0 (because withdraw from stream moves 1 secon further).
          expect((await sUBI.getDelegatedAccruedValue(sender.address)).toNumber()).to.eq(360000 + 0);
        })

      })
    })
  })

});
