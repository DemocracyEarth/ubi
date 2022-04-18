import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { ethers, upgrades, network } from "hardhat";
import moment from "moment";
const testUtils = require("./testUtils");
const pohMockService = require("./utils/pohMockService");
const ubiMockService = require("./utils/ubiMockService");
const deploymentParams = require('../deployment-params');

async function deploySUBI(ubiInstance, governorAddress) {
  const SUBIFactory = await ethers.getContractFactory("sUBI");
  const sUBI = await SUBIFactory.deploy(ubiInstance.address, governorAddress, deploymentParams.SUBI_MAX_STREAMS_ALLOWED, deploymentParams.SUBI_NAME, deploymentParams.SUBI_SYMBOL);
  await sUBI.deployed();
  const tx = await ubiInstance.setDelegator(sUBI.address);
  await tx.wait();
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

    // default all accounts to not registered
    for(let i = 0; i < accounts.length; i++) {
      await pohMockService.setSubmissionIsRegistered(mockPoh, accounts[i].address, false);
    }
  })

  describe("Basic tests", () => {
    it("Should correctly set contract initial parameters on deployment", async () => {
      // ARRANGE
      const SUBIFactory = await ethers.getContractFactory("sUBI");

      // ACT
      const sUBI = await SUBIFactory.deploy(mockUBI.address, accounts[0].address, deploymentParams.SUBI_MAX_STREAMS_ALLOWED, deploymentParams.SUBI_NAME, deploymentParams.SUBI_SYMBOL);
      await sUBI.deployed();


      // ASSERT
      expect(await sUBI.name()).to.equal(deploymentParams.SUBI_NAME);
      expect(await sUBI.symbol()).to.equal(deploymentParams.SUBI_SYMBOL);
      expect((await sUBI.maxStreamsAllowed()).toNumber()).to.equal(deploymentParams.SUBI_MAX_STREAMS_ALLOWED);
      expect((await sUBI.ubi())).to.equal(mockUBI.address);

    });

    it("Should correctly mint stream when executing createStream on UBI", async () => {

      // ARRANGE
      const sUBI = await deploySUBI(ubi, accounts[0].address);
      const sender = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await ubi.startAccruing(sender.address)

      const currentBlockTime = await testUtils.getCurrentBlockTime();
      const dateFrom = currentBlockTime + 10;
      const dateTo = dateFrom + 20;

      // ACT
      await ubi.connect(sender).createDelegation(sUBI.address, accounts[2].address, 10000, ethers.utils.defaultAbiCoder.encode(["uint256", "uint256", "bool"], [dateFrom, dateTo, false]));

      // // ASSERT
      expect((await sUBI.balanceOf(accounts[2].address)).toNumber()).to.equal(1);
    });

    
    it("fail path - Executing onWithdraw from user should fail", async () => {
      // ARRANGE
      const sUBI = await deploySUBI(ubi, accounts[0].address);
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
      const lastStreamId = await testUtils.createCancellableStream(sender,
        recipient.address,
        100,
        fromDate,
        toDate,
        ubi, sUBI);

      // ACT & ASSERT
      // move to middle of stream
      await testUtils.goToMiddleOfStream(lastStreamId, sUBI, network);
      // execute onWidthdraw from stream should fail
      await expect(sUBI.onWithdraw(lastStreamId)).to.be.revertedWith("caller is not UBI contract");
    })

    it("require fail - Creating stream of UBI per second higher than UBI.accruedPerSecond should fail.", async () => {
      // ARRANGE
      const sUBI = await deploySUBI(ubi, accounts[0].address);
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
      await expect(testUtils.createCancellableStream(sender,
        recipient.address,
        newStreamPaymentPerSecond,
        fromDate,
        toDate,
        ubi, sUBI)).to.be.revertedWith("Cannot delegate a value higher than accruedPerSecond");;


    });

    it("require fail - Creating a stream from a non registered account should fail.", async () => {
      // ARRANGE
      const sUBI = await deploySUBI(ubi, accounts[0].address);
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
      await expect(testUtils.createCancellableStream(sender,
        recipient.address,
        100,
        fromDate,
        toDate,
        ubi, sUBI))
        .to.be.revertedWith("not registered or not accruing.");

    });

    it("require fail - Creating a stream from a registered account NOT accruing UBI should fail.", async () => {
      // ARRANGE
      const sUBI = await deploySUBI(ubi, accounts[0].address);
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
      await expect(testUtils.createCancellableStream(sender,
        recipient.address,
        100,
        fromDate,
        toDate,
        ubi, sUBI))
        .to.be.revertedWith("not registered or not accruing.");
    });

    it("happy path - After creating a stream with full accrual that starts in the future, human should accrue UBI until stream starts.", async () => {
      const sUBI = await deploySUBI(ubi, accounts[0].address);
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
      const lastStreamId = await testUtils.createCancellableStream(
        sender,
        recipient.address,
        accruedPerSecond.toNumber(),
        fromDate, toDate,
        ubi, sUBI);

      const afterCreationBlockTime = await testUtils.getCurrentBlockTime();

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
      expect(currHumanBalance).to.eq(prevHumanBalance.add(accruedPerSecond.mul(streamStartBlockTime - afterCreationBlockTime)), "Human balance ");

      const currentStreamBalance = await sUBI.balanceOfStream(lastStreamId);
      expect(currentStreamBalance.toNumber()).to.eq(0, "Current stream balance should still be 0");
    });

    it("happy path - After recipient withdraws from finished stream, human balance should be correctly accrued.", async () => {
      // ARRANGE
      const sUBI = await deploySUBI(ubi, accounts[0].address);
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
      const lastStreamId = await testUtils.createCancellableStream(
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
      await ubi.connect(accounts[1]).withdrawFromDelegations(sUBI.address, [lastStreamId]);

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
      const sUBI = await deploySUBI(ubi, accounts[0].address);
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
      const lastStreamId = await testUtils.createCancellableStream(
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
      const sUBI = await deploySUBI(ubi, accounts[0].address);
      const sender = accounts[0];
      const recipient = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, false);
      await pohMockService.setSubmissionIsRegistered(mockPoh, recipient.address, false);

      // Create stream 1 minute after current blockTime
      const currentBlockTime = await testUtils.getCurrentBlockTime();
      const fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
      const toDate = moment(fromDate).add(1, "hour").toDate();

      await expect(testUtils.createCancellableStream(
        sender,
        recipient.address,
        accruedPerSecond.toNumber(),
        fromDate, toDate,
        ubi, sUBI)).to.be.revertedWith("not registered or not accruing.");
    })

    it("happy path - Creating a new stream after one has finished and has been withdrawn should not increment the number of active streams", async () => {
      // ARRANGE
      const sUBI = await deploySUBI(ubi, accounts[0].address);
      const sender = accounts[0];
      const recipient = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await pohMockService.setSubmissionIsRegistered(mockPoh, recipient.address, false);
      await ubi.startAccruing(sender.address);

      // Create stream 1 minute after current blockTime
      let currentBlockTime = await testUtils.getCurrentBlockTime();
      let fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
      let toDate = moment(fromDate).add(1, "hour").toDate();

      const stream1Id = await testUtils.createCancellableStream(
        sender,
        recipient.address,
        accruedPerSecond.toNumber(),
        fromDate, toDate,
        ubi, sUBI);

      // Get the previous stream count
      const prevStreamsCount = await sUBI.getStreamsCount(sender.address);
      // Move blocktime top the end of last stream
      await testUtils.goToEndOfStream(stream1Id, sUBI, network);

      // Withdraw the balance from the stream
      await ubi.connect(recipient).withdrawFromDelegations(sUBI.address, [stream1Id]);

      // Create a 2nd stream
      currentBlockTime = await testUtils.getCurrentBlockTime();
      fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
      toDate = moment(fromDate).add(1, "hour").toDate();

      // Create stream with half ubiPerSecond delegation
      const stream2Id = await testUtils.createCancellableStream(
        sender,
        recipient.address,
        accruedPerSecond,
        fromDate, toDate,
        ubi, sUBI);
      const currStreamsCount = await sUBI.getStreamsCount(sender.address);
      expect(currStreamsCount.toNumber()).to.eq(prevStreamsCount.toNumber(), "Creating a stream after another has finished and been withdrawn should not increase stream count");
    });

    it("happy path - Creating a new stream after one has finished and has not been withdrawn should increment the number of active streams", async () => {
      // ARRANGE
      const sUBI = await deploySUBI(ubi, accounts[0].address);
      const sender = accounts[0];
      const recipient = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await pohMockService.setSubmissionIsRegistered(mockPoh, recipient.address, false);
      await ubi.startAccruing(sender.address);

      // Create stream 1 minute after current blockTime
      let currentBlockTime = await testUtils.getCurrentBlockTime();
      let fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
      let toDate = moment(fromDate).add(1, "hour").toDate();

      // Delegate half of UBI per second
      const delegatedPerSecond = accruedPerSecond.div(2);

      const stream1Id = await testUtils.createCancellableStream(
        sender,
        recipient.address,
        delegatedPerSecond,
        fromDate, toDate,
        ubi, sUBI);

      // Move blocktime top the end of last stream
      await testUtils.goToEndOfStream(stream1Id, sUBI, network);

      // Get the previous stream count
      const prevStreamsCount = await sUBI.getStreamsCount(sender.address);

      // Create a new stream
      currentBlockTime = await testUtils.getCurrentBlockTime();
      fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
      toDate = moment(fromDate).add(1, "hour").toDate();

      // Create stream with half ubiPerSecond delegation
      const stream2Id = await testUtils.createCancellableStream(
        sender,
        recipient.address,
        delegatedPerSecond,
        fromDate, toDate,
        ubi, sUBI);
      const currStreamsCount = await sUBI.getStreamsCount(sender.address);
      expect(currStreamsCount.toNumber()).to.eq(prevStreamsCount.add(1).toNumber(), "Creating a stream after another has finished but not withdrawn should increase stream count");
    });

    it("happy path - Creating a new stream while others are running or pending should increment the number of active streams", async () => {
      // ARRANGE
      const sUBI = await deploySUBI(ubi, accounts[0].address);
      const sender = accounts[0];
      const recipient = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await pohMockService.setSubmissionIsRegistered(mockPoh, recipient.address, false);
      await ubi.startAccruing(sender.address);

      // Create stream 1 minute after current blockTime
      let currentBlockTime = await testUtils.getCurrentBlockTime();
      let fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
      let toDate = moment(fromDate).add(1, "hour").toDate();

      // Delegate half of UBI per second
      const delegatedPerSecond = accruedPerSecond.div(2).toNumber();
      // Create first stream
      const streamId1 = await testUtils.createCancellableStream(
        sender,
        recipient.address,
        delegatedPerSecond,
        fromDate, toDate,
        ubi, sUBI);

      const prevStreamsCount = await sUBI.getStreamsCount(sender.address);

      // Move blocktime to the begining of the previous stream
      await testUtils.goToStartOfStream(streamId1, sUBI, network);

      // Create stream 2 times
      currentBlockTime = await testUtils.getCurrentBlockTime();
      fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
      toDate = moment(fromDate).add(1, "hour").toDate();

      // ACT
      // Create another stream with half of ubiperSecond delegation (previous stream is half already)
      const streamId2 = await testUtils.createCancellableStream(
        sender,
        recipient.address,
        delegatedPerSecond,
        fromDate,
        toDate,
        ubi, sUBI);

      // ASSERT
      const currStreamsCount = await sUBI.getStreamsCount(sender.address);
      expect(currStreamsCount.toNumber()).to.eq(prevStreamsCount.toNumber() + 1, "Creating a stream after another has finished should not increase stream count");
    });

    it("happy path - Creating 2 streams with half accruedPerSecond per each should accrue the same value on both.", async () => {
      // ARRANGE
      const sUBI = await deploySUBI(ubi, accounts[0].address);
      const sender = accounts[0];
      const recipient1 = accounts[1];
      const recipient2 = accounts[2];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await pohMockService.setSubmissionIsRegistered(mockPoh, recipient1.address, false);
      await pohMockService.setSubmissionIsRegistered(mockPoh, recipient2.address, false);
      await ubi.startAccruing(sender.address);

      // Create stream 1 minute after current blockTime
      let currentBlockTime = await testUtils.getCurrentBlockTime();
      let fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
      let toDate = moment(fromDate).add(1, "hour").toDate();

      // Delegate half of UBI per second
      const delegatedPerSecond = accruedPerSecond.div(2);

      // Get stream counts
      const initialStreamCount = await sUBI.getStreamsCount(sender.address);

      // ACT 
      // Create 2 streams with accruedPerSecond / 2
      const streamId1 = await testUtils.createCancellableStream(sender, recipient1.address, delegatedPerSecond, fromDate, toDate, ubi, sUBI);
      const streamId2 = await testUtils.createCancellableStream(sender, recipient2.address, delegatedPerSecond, fromDate, toDate, ubi, sUBI);

      // ASSERT
      expect(await sUBI.getStreamsCount(sender.address)).to.eq(initialStreamCount.add(2), "Stream count should have increased by 2");

      // Move blocktime to end of first stream (2nd is the same)
      const firstStream = await sUBI.getStream(streamId1);
      await testUtils.setNextBlockTime(firstStream.stopTime.toNumber(), network);

      // Accrued balance should be half UBI for both streamn
      const firstStreamBalance = await sUBI.balanceOfStream(streamId1);
      const secondStreamBalance = await sUBI.balanceOfStream(streamId2);
      expect(firstStreamBalance).to.eq(delegatedPerSecond.mul(3600), "Invalid balance of first stream");
      expect(secondStreamBalance).to.eq(delegatedPerSecond.mul(3600), "Invalid balance of second stream");
    });

    it("happy path - After a stream finishes, total pending delegated value should increase by the total balance of the stream", async () => {
      // ARRANGE
      const sUBI = await deploySUBI(ubi, accounts[0].address);
      const sender = accounts[0];
      const recipient1 = accounts[1];

      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await pohMockService.setSubmissionIsRegistered(mockPoh, recipient1.address, false);
      await ubi.startAccruing(sender.address);

      // Create stream 1 minute after current blockTime
      let currentBlockTime = await testUtils.getCurrentBlockTime();
      let fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
      let toDate = moment(fromDate).add(1, "hour").toDate();

      // ACT 
      // Create a streams with accruedPerSecond
      const streamId = await testUtils.createCancellableStream(sender, recipient1.address, accruedPerSecond, fromDate, toDate, ubi, sUBI);

      // Get the initial pending delegated value
      const initialPendingDelegatedValue = await sUBI.outgoingTotalAccruedValue(sender.address);

      // Move blocktime to end of stream
      await testUtils.goToEndOfStream(streamId, sUBI, network);

      // ASSERT
      const finalStreamBalance = await sUBI.balanceOfStream(streamId);
      expect(finalStreamBalance).to.eq(accruedPerSecond.mul(60 * 60), "Stream should increase its balance by 1 hour of UBI accruance")

      // Get the final pending delegated value
      const finalPendingDelegatedValue = await sUBI.outgoingTotalAccruedValue(sender.address);

      // Should be equal to initial + 1 hour of UBI accruance
      expect(finalPendingDelegatedValue).to.eq(initialPendingDelegatedValue.add(finalStreamBalance), "Pending delegated value should account for last finished stream.");

    });

    it("happy path - Creating 1 streams with half accruedPerSecond should accrue half for the stream and half for the human.", async () => {
      // ARRANGE
      const sUBI = await deploySUBI(ubi, accounts[0].address);
      const sender = accounts[0];
      const recipient1 = accounts[1];

      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await pohMockService.setSubmissionIsRegistered(mockPoh, recipient1.address, false);
      await ubi.startAccruing(sender.address);

      // Create stream 1 minute after current blockTime
      let currentBlockTime = await testUtils.getCurrentBlockTime();
      let fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
      let toDate = moment(fromDate).add(1, "hour").toDate();

      // ACT 
      // Create a streams with accruedPerSecond
      const delegatedPerSecond = accruedPerSecond.div(2);
      const streamId = await testUtils.createCancellableStream(sender, recipient1.address, delegatedPerSecond, fromDate, toDate, ubi, sUBI);

      // Move blocktime to start of stream
      const stream = await sUBI.getStream(streamId);
      await testUtils.setNextBlockTime(stream.startTime.toNumber(), network);

      // get initial balance of stream and human
      const prevhumanBalance = await ubi.balanceOf(sender.address);
      const prevStreamBalance = await sUBI.balanceOfStream(streamId);

      // Move blocktime to end of stream
      await testUtils.goToEndOfStream(streamId, sUBI, network);

      // ASSERT

      // get last balance of stream and human
      const newHumanBalance = await ubi.balanceOf(sender.address);
      const lastStreamBalance = await sUBI.balanceOfStream(streamId);

      // Accrued balance should be half UBI for both streamn
      expect(newHumanBalance).to.eq(prevhumanBalance.add(delegatedPerSecond.mul(3600)), "Human should accrue only half of UBI");
      expect(lastStreamBalance).to.eq(prevStreamBalance.add(delegatedPerSecond.mul(3600)), "Stream should accrue only half of UBI");
    })

    it("require fail - Creating more than `maxStreamsAllowed` on the same time window should fail", async () => {
      // ARRANGE
      const sUBI = await deploySUBI(ubi, accounts[0].address);
      const sender = accounts[0];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);

      await ubi.startAccruing(sender.address);

      // Calculate corresponding ubi per second to delegate to each stream 
      const streamsToCreate = await sUBI.maxStreamsAllowed();
      const ubiPerSecondPerDelegate = accruedPerSecond.div(streamsToCreate+1);

      // Create a new stream with half ubiPerSecond
      const currentBlockTime = await testUtils.getCurrentBlockTime();
      const fromDate = moment(new Date(currentBlockTime * 1000)).add(10, "minutes").toDate();
      const toDate = moment(fromDate).add(1, "hour").toDate();

      // Saturate max streams available to create
      for (let i = 0; i < streamsToCreate; i++) {
        // Get a new address index considering the length of the accounts array.
        const addressIndex = Math.min(i + 1, accounts.length - 1);
        await testUtils.createCancellableStream(sender, accounts[addressIndex].address, ubiPerSecondPerDelegate, fromDate, toDate, ubi, sUBI);
      }

      // ACT && ASSERT
      // Create one more stream which shuould fail
      await expect(testUtils.createCancellableStream(sender, accounts[1].address, ubiPerSecondPerDelegate, fromDate, toDate, ubi, sUBI))
        .to.be.revertedWith("max streams exceeded");
    });

    it("happy path - Creating more than `maxStreamsAllowed` on different times should succeed", async () => {

      // ARRANGE
      const sUBI = await deploySUBI(ubi, accounts[0].address);
      const sender = accounts[0];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);

      await ubi.startAccruing(sender.address);

      // Calculate corresponding ubi per second to delegate to each stream 
      const streamsToCreate = await sUBI.maxStreamsAllowed();
      const ubiPerSecondPerDelegate = accruedPerSecond.div(streamsToCreate.toNumber());

      let testPassed = false;
      let streamId;
      // Create multiple streams with same date period
      for (let i = 0; i < streamsToCreate; i++) {
        // If last Stream ID is set, move to the end of the stream
        if (streamId) {
          await testUtils.goToEndOfStream(streamId, sUBI, network);
        }
        // Get streams parameters
        const currentBlockTime = await testUtils.getCurrentBlockTime();
        const fromDate = moment(new Date(currentBlockTime * 1000)).add(10, "minutes").toDate();
        const toDate = moment(fromDate).add(1, "hour").toDate();

        // Get a new address index considering the length of the accounts array.
        const addressIndex = Math.min(i + 1, accounts.length - 1);
        streamId = await testUtils.createCancellableStream(sender, accounts[addressIndex].address, ubiPerSecondPerDelegate, fromDate, toDate, ubi, sUBI);
      }
      expect(await sUBI.getStreamsCount(sender.address)).to.eq(streamsToCreate);
    });

    it("require fail - Creating 2 overlaping streams that, when overlaped, sum more than the allowed ubiPerSecond should fail", async () => {
      // ARRANGE
      const sUBI = await deploySUBI(ubi, accounts[0].address);
      const sender = accounts[0];
      const recipient = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await ubi.startAccruing(sender.address);

      // initial variables
      const currentBlockTime = await testUtils.getCurrentBlockTime();

      // Create a stream with total accrued per second
      const fromDate1 = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
      const toDate1 = moment(fromDate1).add(1, "hour").toDate();
      await testUtils.createCancellableStream(sender, recipient.address, accruedPerSecond, fromDate1, toDate1, ubi, sUBI);

      // Create a second stream with total accrued per second but that starts after previous stream starts and before it finishes
      const fromDate2 = moment(fromDate1).add(30, "minutes").toDate();
      const toDate2 = moment(fromDate2).add(1, "hour").toDate();
      await expect(testUtils.createCancellableStream(sender, recipient.address, accruedPerSecond, fromDate2, toDate2, ubi, sUBI))
        .to.be.revertedWith("not enough value to delegate");
    })

    it("happy path - after delegating and withdrawing from recipient, getting balance of delegator should work correctly", async () => {
      // ARRANGE
      const sUBI = await deploySUBI(ubi, accounts[0].address);
      const sender = accounts[0];
      const recipient = accounts[2];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await ubi.startAccruing(sender.address);

      // Delegate per second
      const delegatedPerSecond = 101;

      // Create a stream with total accrued per second
      const currentBlockTime = await testUtils.getCurrentBlockTime();
      const fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
      const toDate = moment(fromDate).add(1, "hour").toDate();

      // Create 1 streams with half of accrued per second.
      const streamId = await testUtils.createCancellableStream(sender, recipient.address, delegatedPerSecond, fromDate, toDate, ubi, sUBI);

      // Move blocktime to start of stream
      await testUtils.goToStartOfStream(streamId, sUBI, network);
      const prevStreamBalance = await sUBI.balanceOfStream(streamId);
      expect(prevStreamBalance).to.eq(0);
      const prevSenderBalance = await ubi.balanceOf(sender.address);
      const prevRecipientBalance = await ubi.balanceOf(recipient.address);
      // This steps 1 second on the chain
      await ubi.connect(recipient).withdrawFromDelegations(sUBI.address, [streamId]);
      // ASSERT
      // Get new balances
      const lastStreamBalance = await sUBI.balanceOfStream(streamId);
      const lastSenderBalance = await ubi.balanceOf(sender.address);
      const lastRecipientBalance = await ubi.balanceOf(recipient.address);
      
      // Stream balance should be 0 (because it was withdrawn)
      expect(lastStreamBalance).to.eq(0, "Invalid last stream balance");
      // Recipient balance should be the value withdrawn (1 second)
      expect(lastRecipientBalance).to.eq(prevRecipientBalance.add(delegatedPerSecond), "Invalid last recipient balance");
      // Sender balance should be the p´rev balance + (accrued - delegated).
      expect(lastSenderBalance).to.eq(prevSenderBalance.add(accruedPerSecond.sub(delegatedPerSecond)), "Invalid sender balance");
    });

    it("happy path - after creating 3 streams (current and in the future), human should have 3 active streams.", async () => {
      // ARRANGE
      const sUBI = await deploySUBI(ubi, accounts[0].address);
      const sender = accounts[0];
      const recipient = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await ubi.startAccruing(sender.address);

      // Create 3 streams, with one hour difference each
      const initialBlockTime = await testUtils.getCurrentBlockTime();
      // Stream starts at current blocktime + 1 hour
      const fromDate1 = moment(new Date(initialBlockTime * 1000)).add(1, "hours").toDate();
      const fromDate2 = moment(new Date(initialBlockTime * 1000)).add(2, "hours").toDate();
      const fromDate3 = moment(new Date(initialBlockTime * 1000)).add(3, "hours").toDate();
      // Stream lasts 1 hours
      const toDate1 = moment(fromDate1).add(1, "hour").toDate();
      const toDate2 = moment(fromDate2).add(1, "hour").toDate();
      const toDate3 = moment(fromDate3).add(1, "hour").toDate();

      // Create a stream from address 0 to address 1
      const streamId1 = await testUtils.createCancellableStream(sender, recipient.address, 1000, fromDate1, toDate1, ubi, sUBI);
      const streamId2 = await testUtils.createCancellableStream(sender, recipient.address, 1000, fromDate2, toDate2, ubi, sUBI);
      const streamId3 = await testUtils.createCancellableStream(sender, recipient.address, 1000, fromDate3, toDate3, ubi, sUBI);

      // Move to the middle of first stream
      await testUtils.goToMiddleOfStream(streamId1, sUBI, network);

      // ASSERT
      const activeStreams = await sUBI.getActiveStreamsOf(sender.address);
      expect(activeStreams.length).to.eq(3, "Human should have 3 active streams");
    });
  })

  describe("Withdrawals", () => {
    it("happy path - After stream is finished, and recipient withdraws the balance, stream balance should be 0 and recipient balance should be the stream total", async () => {

      // ARRANGE
      const sUBI = await deploySUBI(ubi, accounts[0].address);
      const sender = accounts[0];
      const recipient = accounts[2];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await ubi.startAccruing(sender.address);

      // Create a new stream with half ubiPerSecond
      const currentBlockTime = await testUtils.getCurrentBlockTime();
      const fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
      const toDate = moment(fromDate).add(1, "hour").toDate();

      // Delegate half of UBI per second
      const delegatedPerSecond = accruedPerSecond.div(2).toNumber();

      // Create 1 stream with accruedPerSecond.
      const streamId = await testUtils.createCancellableStream(sender, recipient.address, delegatedPerSecond, fromDate, toDate, ubi, sUBI);

      // Move blocktime to end of stream
      await testUtils.goToEndOfStream(streamId, sUBI, network);

      // Get balances
      const prevRecipientBalance = await ubi.balanceOf(recipient.address);
      const prevStreamBalance = await sUBI.balanceOfStream(streamId);

      // ACT
      // Recipient withdraws balance 
      await ubi.connect(recipient).withdrawFromDelegations(sUBI.address, [streamId]);

      // ASSERT
      // Balance was withdrawn from completed stream so it shouldnt exist any more
      expect(await sUBI.balanceOfStream(streamId)).to.eq(0, "Stream balance should be 0");

      // New balance of recipient should be previous + streamBalance
      const newRecipientBalance = await ubi.balanceOf(recipient.address);
      expect(newRecipientBalance).to.eq(prevRecipientBalance.add(prevStreamBalance), "Recipient balance should increase by the balance of the stream.");
    })

    it("happy path - After withdrawing from an active stream, balance should be 0 right after, but keep accruing until the end.", async () => {
      // ARRANGE
      const sUBI = await deploySUBI(ubi, accounts[0].address);
      const sender = accounts[0];
      const recipient = accounts[2];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await ubi.startAccruing(sender.address);

      // New stream will start in 1 minute and last for 1 hour
      const currentBlockTime = await testUtils.getCurrentBlockTime();
      const fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
      const toDate = moment(fromDate).add(1, "hour").toDate();

      // Create stream
      const streamId = await testUtils.createCancellableStream(sender, recipient.address, accruedPerSecond.toNumber(), fromDate, toDate, ubi, sUBI);

      // Go to start
      await testUtils.goToStartOfStream(streamId, sUBI, network);

      // Get balances
      const prevRecipientBalance = await ubi.balanceOf(recipient.address);
      const initialStreamBalance = await sUBI.balanceOfStream(streamId);
      expect(initialStreamBalance.toNumber()).to.eq(0, "Initial stream balance should be 0");

      // Move fwd 30 mins
      await testUtils.goToMiddleOfStream(streamId, sUBI, network);

      // The new stream balance should be half a UBI (ubiPerSecond * 30 * 60).
      const currentStreamBalance = await sUBI.balanceOfStream(streamId);
      expect(currentStreamBalance).to.eq(initialStreamBalance.add(accruedPerSecond.mul(30 * 60)), "Stream accrued balance should be half a UBI.");

      // Withdraw the current stream balance *️⃣(this mines a block and moves blocktime by 1 second)
      await ubi.connect(sender).withdrawFromDelegations(sUBI.address, [streamId]);

      // New recipient balance should be the same as previous + current stream balance + 1 second (because of *️⃣)
      const newRecipientBalance = await ubi.balanceOf(recipient.address);
      expect(newRecipientBalance).to.eq(prevRecipientBalance.add(currentStreamBalance).add(accruedPerSecond), "After withdrawal, recipient balance should increase by the amount of withdrawn balance");

      const currTimestamp = await testUtils.getCurrentBlockTime();
      // // Move to the end of the stream and check stream balance.
      await testUtils.goToEndOfStream(streamId, sUBI, network);

      // Get elapsed time
      const elapsed = (await testUtils.getCurrentBlockTime()) - currTimestamp;

      // Final balance sholud be elapsed time of accruance (because of *️⃣)
      const finalStreamBalance = await sUBI.balanceOfStream(streamId);
      expect(finalStreamBalance).to.eq(accruedPerSecond.mul(elapsed), "After stream finishes, the balance should account for the withdrawn balance.");
    })

    it("happy path - Withdraw in the middle of stream and after it finished should add the total delegated balance to stream recipient", async () => {
      // ARRANGE
      const sUBI = await deploySUBI(ubi, accounts[0].address);
      const sender = accounts[0];
      const recipient = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await ubi.startAccruing(sender.address);

      // Create a new stream with half ubiPerSecond
      const currentBlockTime = await testUtils.getCurrentBlockTime();
      const fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
      const toDate = moment(fromDate).add(1, "hour").toDate();

      // Delegate half of UBI per second
      const delegatedPerSecond = accruedPerSecond.div(2);

      // Create 1 stream with accruedPerSecond.
      const streamId = await testUtils.createCancellableStream(sender, recipient.address, delegatedPerSecond, fromDate, toDate, ubi, sUBI);

      // Move blocktime to the middle of the stream
      await testUtils.goToMiddleOfStream(streamId, sUBI, network);

      // Get balances
      const prevRecipientBalance = await ubi.balanceOf(recipient.address);
      const prevStreamBalance = await sUBI.balanceOfStream(streamId);

      // Recipient withdraws balance 
      await ubi.connect(recipient).withdrawFromDelegations(sUBI.address, [streamId]);

      // New balance of recipient should be previous + streamBalance (+1 sec)
      const newRecipientBalance = await ubi.balanceOf(recipient.address);
      expect(newRecipientBalance).to.eq(prevRecipientBalance.add(prevStreamBalance).add(delegatedPerSecond), "Recipient balance should increase by the withdrawn balance of the stream.");

      // Move to the end of the stream
      await testUtils.goToEndOfStream(streamId, sUBI, network);

      // Stream lasted 1 hour and withdraw was at 30 minutes of stream. Remaining balance should account for the remaining 30 minutes (-1 sec)
      const remainingStreamBalance = await sUBI.balanceOfStream(streamId);
      expect(remainingStreamBalance).to.eq(delegatedPerSecond.mul((30 * 60) - 1), "Stream balance should be delegatedPerSecond * 30 minutes");

      // Withdraw remaining balance.
      await ubi.connect(accounts[1]).withdrawFromDelegations(sUBI.address, [streamId]);

      // Last balance of recipient should be the total of the stream (1 hour of delegatedPerSecond)
      const finalRecipientBalance = await ubi.balanceOf(recipient.address);
      expect(finalRecipientBalance).to.eq(prevRecipientBalance.add(delegatedPerSecond.mul(60 * 60)), "Recipient balance should increase by the balance of the stream.");
    })

    it("happy path - After withdrawing from an ended stream, number of streams should decrease by 1", async () => {
      // ARRANGE
      const sUBI = await deploySUBI(ubi, accounts[0].address);
      const sender = accounts[0];
      const recipient = accounts[1];
      const ubiRecipient = accounts[2];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await ubi.startAccruing(sender.address);

      // Get number of streamsd
      const currentBlockTime = await testUtils.getCurrentBlockTime();
      const fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
      const toDate = moment(fromDate).add(1, "hour").toDate();

      // Create a new stream with half accruedPerSecond
      const delegatedPerSecond = accruedPerSecond.div(2);


      //  Get number of stream for the creator of stream 
      const initialStreamCount = await sUBI.getStreamsCount(sender.address);

      // Create 1 stream with accruedPerSecond as the total.
      const streamId = await testUtils.createCancellableStream(sender, recipient.address, delegatedPerSecond, fromDate, toDate, ubi, sUBI);

      //  Get number of stream for the creator of stream 
      const nextStreamCount = await sUBI.getStreamsCount(sender.address);
      expect(nextStreamCount).to.eq(initialStreamCount.add(1), "Stream count should increase when user creates a new stream");

      // Move to the end of the stream
      await testUtils.goToEndOfStream(streamId, sUBI, network);

      // Get stream balance and expect it to be 1 UBI
      const streamBalance = await sUBI.balanceOfStream(streamId);
      expect(streamBalance).to.eq(delegatedPerSecond.mul(60 * 60), "Stream balance should be 1 UBI");

      // Recipient withdraws balance 
      await ubi.connect(recipient).withdrawFromDelegations(sUBI.address, [streamId]);

      //  Get number of stream for the creator of stream 
      const lastStreamCount = await sUBI.getStreamsCount(sender.address);
      expect(lastStreamCount).to.eq(initialStreamCount, "Stream count should decrease after recipient withdraws from a completed stream");
    })

    it("happy path - While a stream is active, and sender transfers to another recipient, sender should have the right balance", async () => {

      // ARRANGE
      const sUBI = await deploySUBI(ubi, accounts[0].address);
      const sender = accounts[0];
      const recipient = accounts[1];
      const ubiRecipient = accounts[2];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await ubi.startAccruing(sender.address);

      // Create a new stream with half accruedPerSecond
      const currentBlockTime = await testUtils.getCurrentBlockTime();
      const fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
      const toDate = moment(fromDate).add(1, "hour").toDate();

      // Hald accruedPerSecond
      const delegatedPerSecond = accruedPerSecond.div(2);

      //  Get number of stream for the creator of stream 
      const initialStreamCount = await sUBI.getStreamsCount(sender.address);

      // Create 1 stream with accruedPerSecond as the total.
      const streamId = await testUtils.createCancellableStream(sender, recipient.address, delegatedPerSecond, fromDate, toDate, ubi, sUBI);

      //  Get number of stream for the creator of stream 
      const nextStreamCount = await sUBI.getStreamsCount(sender.address);
      expect(nextStreamCount).to.eq(initialStreamCount.add(1), "Stream count should increase when user creates a new stream");

      // Go to start of stream
      await testUtils.goToStartOfStream(streamId, sUBI, network);

      // Get initial balance of sender
      const prevSenderBalance = await ubi.balanceOf(sender.address);

      // Move to the end of the stream
      await testUtils.goToMiddleOfStream(streamId, sUBI, network);

      // Get new balance
      const middleSenderBalance = await ubi.balanceOf(sender.address);
      const middleBlockTime = await testUtils.getCurrentBlockTime();

      // get the stream
      const stream = await sUBI.getStream(streamId);

      // Expect sender to have accrued the value of accruedPerSecond-delegatedPerSecond in half an hour
      expect(middleSenderBalance).to.eq(prevSenderBalance.add(accruedPerSecond.sub(delegatedPerSecond).mul(middleBlockTime - stream.startTime.toNumber())))

      // Transfer 1 UBI from account 0 to account 2
      const amountToTransfer = ethers.utils.parseEther("1");
      const account2PrevBalance = await ubi.balanceOf(ubiRecipient.address);

      await ubi.connect(sender).transfer(ubiRecipient.address, amountToTransfer);
      const account2NewBalance = await ubi.balanceOf(ubiRecipient.address);
      expect(account2NewBalance).to.eq(account2PrevBalance.add(amountToTransfer), "After transfer account 2 should increase");

      // New balance of sender should be prevBalance - 1 UBI
      const afterTransferSenderBalance = await ubi.balanceOf(sender.address);
      const expectedBalance = middleSenderBalance.add(accruedPerSecond.sub(delegatedPerSecond)).sub(amountToTransfer);;
      expect(afterTransferSenderBalance).to.eq(expectedBalance, "After transfer sender's balance should have decreased by 1 UBI (+1 sec of accruance)");

      // Move to end of stream
      await testUtils.goToEndOfStream(streamId, sUBI, network);

      // Get current blocktime
      const endBlockTime = await testUtils.getCurrentBlockTime();

      // Get the current stream balance
      const streamBalance = await sUBI.balanceOfStream(streamId);
      // Should be the delegatedPerSecond * stream duration
      expect(streamBalance).to.eq(delegatedPerSecond.mul(endBlockTime - stream.startTime.toNumber()))
      // Recipient withdraws balance 
      await ubi.connect(recipient).withdrawFromDelegations(sUBI.address, [streamId]);

      //  Get number of stream for the creator of stream 
      const lastStreamCount = await sUBI.getStreamsCount(sender.address);
      expect(lastStreamCount).to.eq(initialStreamCount, "Stream count should decrease after recipient withdraws from a completed stream");
    })

    it("happy path - While a stream is active, and sender transferFrom UBI, sender should have the right balance", async () => {

      // ARRANGE
      const sUBI = await deploySUBI(ubi, accounts[0].address);
      const sender = accounts[0];
      const recipient = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await ubi.startAccruing(sender.address);

      // Create a new stream with half accruedPerSecond
      const currentBlockTime = await testUtils.getCurrentBlockTime();
      const fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
      const toDate = moment(fromDate).add(1, "hour").toDate();

      // 1000 UBIwei
      const delegatedPerSecond = BigNumber.from(1000);

      //  Get number of stream for the creator of stream 
      const initialStreamCount = await sUBI.getStreamsCount(sender.address)

      // Create 1 stream with accruedPerSecond as the total.
      const streamId = await testUtils.createCancellableStream(sender, recipient.address, delegatedPerSecond, fromDate, toDate, ubi, sUBI);

      //  Get number of stream for the creator of stream 
      const nextStreamCount = await sUBI.getStreamsCount(sender.address);
      expect(nextStreamCount).to.eq(initialStreamCount.add(1), "Stream count should increase when user creates a new stream");

      // Approve transfer of  1 UBI from account 0 to account 1
      const amountToTransfer = ethers.utils.parseEther("1");
      await ubi.connect(accounts[0]).approve(recipient.address, amountToTransfer.toString()); // +1 sec

      // Go to start of stream
      await testUtils.goToStartOfStream(streamId, sUBI, network);

      // Get initial balance of sender
      const prevSenderBalance = await ubi.balanceOf(sender.address);

      // Move to the end of the stream
      await testUtils.goToMiddleOfStream(streamId, sUBI, network);

      // Get new balance
      const middleSenderBalance = await ubi.balanceOf(sender.address);
      const middleRecipientBalance = await ubi.balanceOf(recipient.address);
      const middleBlockTime = await testUtils.getCurrentBlockTime();

      // get the stream
      const stream = await sUBI.getStream(streamId);

      // Expect sender to have accrued the value of accruedPerSecond-delegatedPerSecond in half an hour
      expect(middleSenderBalance).to.eq(prevSenderBalance.add(accruedPerSecond.sub(delegatedPerSecond).mul(middleBlockTime - stream.startTime.toNumber())))
      // ACT
      await ubi.connect(recipient).transferFrom(sender.address, recipient.address, amountToTransfer); // +1 sec

      // Expect recipient to have recivied the value of amount to transfer.
      const afterTransferRecipientBalance = await ubi.balanceOf(recipient.address);
      expect(afterTransferRecipientBalance).to.eq(middleRecipientBalance.add(amountToTransfer), "Recipient balance should increase by 1 UBI");

      // New balance of sender should be prevBalance - 1 UBI (+1 seconds (approve and transferFrom)
      const afterTransferSenderBalance = await ubi.balanceOf(sender.address);
      const expectedBalance = middleSenderBalance.add(accruedPerSecond.sub(delegatedPerSecond)).sub(amountToTransfer);
      expect(afterTransferSenderBalance).to.eq(expectedBalance, "After transferFrom, sender's balance should have decreased by 1 UBI (+1 sec of accruance)");

      // Move to end of stream
      await testUtils.goToEndOfStream(streamId, sUBI, network);

      // Get current blocktime
      const endBlockTime = await testUtils.getCurrentBlockTime();

      // Get the current stream balance
      const streamBalance = await sUBI.balanceOfStream(streamId);
      // Should be the delegatedPerSecond * stream duration
      expect(streamBalance).to.eq(delegatedPerSecond.mul(endBlockTime - stream.startTime.toNumber()));
      // Recipient withdraws balance 
      await ubi.connect(recipient).withdrawFromDelegations(sUBI.address, [streamId]);

      //  Get number of stream for the creator of stream 
      const lastStreamCount = await sUBI.getStreamsCount(sender.address);
      expect(lastStreamCount).to.eq(initialStreamCount, "Stream count should decrease after recipient withdraws from a completed stream");
    })

    it("happy path - While a stream is active, and sender burns UBI, sender should have the right balance", async () => {
      // ARRANGE
      const sUBI = await deploySUBI(ubi, accounts[0].address);
      const sender = accounts[0];
      const recipient = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await ubi.startAccruing(sender.address);

      // Create a new stream with half accruedPerSecond
      const currentBlockTime = await testUtils.getCurrentBlockTime();
      const fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
      const toDate = moment(fromDate).add(1, "hour").toDate();

      // Hald accruedPerSecond
      const delegatedPerSecond = accruedPerSecond.div(2);

      //  Get number of stream for the creator of stream 
      const initialStreamCount = await sUBI.getStreamsCount(sender.address);

      // Create 1 stream with accruedPerSecond as the total.
      const streamId = await testUtils.createCancellableStream(sender, recipient.address, delegatedPerSecond, fromDate, toDate, ubi, sUBI);

      //  Get number of stream for the creator of stream 
      const nextStreamCount = await sUBI.getStreamsCount(sender.address);
      expect(nextStreamCount.toNumber()).to.eq(initialStreamCount.add(1).toNumber(), "Stream count should increase when user creates a new stream");

      // Go to start of stream
      await testUtils.goToStartOfStream(streamId, sUBI, network);

      // Get initial balance of sender
      const prevSenderBalance = await ubi.balanceOf(sender.address);

      // Move to the end of the stream
      await testUtils.goToMiddleOfStream(streamId, sUBI, network);
      // Get new balance
      const middleSenderBalance = await ubi.balanceOf(sender.address);
      const middleBlockTime = await testUtils.getCurrentBlockTime();

      // get the stream
      const stream = await sUBI.getStream(streamId);

      // Expect sender to have accrued the value of accruedPerSecond-delegatedPerSecond in half an hour
      expect(middleSenderBalance).to.eq(prevSenderBalance.add(accruedPerSecond.sub(delegatedPerSecond).mul(middleBlockTime - stream.startTime.toNumber())));

      // Burn 1 UBI
      const amountToBurn = ethers.utils.parseEther("1");
      await ubi.connect(sender).burn(amountToBurn.toString()); // +1 sec

      // New balance of sender should be prevBalance - 1 UBI (+
      const afterBurnSenderBalance = await ubi.balanceOf(sender.address);
      const expectedBalance = middleSenderBalance.sub(amountToBurn).add(accruedPerSecond.sub(delegatedPerSecond));
      expect(afterBurnSenderBalance).to.eq(expectedBalance, "After burn, sender's balance should have decreased by 1 UBI (+1 sec of accruance)");

      // Move to end of stream
      await testUtils.goToEndOfStream(streamId, sUBI, network);

      // Get current blocktime
      const endBlockTime = await testUtils.getCurrentBlockTime();

      // Get the current stream balance
      const streamBalance = await sUBI.balanceOfStream(streamId);
      // Should be the delegatedPerSecond * stream duration
      expect(streamBalance).to.eq(delegatedPerSecond.mul(endBlockTime - stream.startTime.toNumber()));
      // Recipient withdraws balance 
      await ubi.connect(recipient).withdrawFromDelegations(sUBI.address, [streamId]);

      //  Get number of stream for the creator of stream 
      const lastStreamCount = await sUBI.getStreamsCount(sender.address);;
      expect(lastStreamCount).to.eq(initialStreamCount, "Stream count should decrease after recipient withdraws from a completed stream");
    })

    it("happy path - While a stream is active, and sender burnFrom UBI, sender should have the right balance", async () => {

      // ARRANGE
      const sUBI = await deploySUBI(ubi, accounts[0].address);
      const sender = accounts[0];
      const recipient = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await ubi.startAccruing(sender.address);

      // Create a new stream with half accruedPerSecond
      const currentBlockTime = await testUtils.getCurrentBlockTime();
      const fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
      const toDate = moment(fromDate).add(1, "hour").toDate();

      // Hald accruedPerSecond
      const delegatedPerSecond = accruedPerSecond.div(2);

      //  Get number of stream for the creator of stream 
      const initialStreamCount = await sUBI.getStreamsCount(sender.address);

      // Create 1 stream with accruedPerSecond as the total.
      const streamId = await testUtils.createCancellableStream(sender, recipient.address, delegatedPerSecond, fromDate, toDate, ubi, sUBI);

      //  Get number of stream for the creator of stream 
      const nextStreamCount = await sUBI.getStreamsCount(sender.address);
      expect(nextStreamCount).to.eq(initialStreamCount.add(1), "Stream count should increase when user creates a new stream");

      // Go to start of stream
      await testUtils.goToStartOfStream(streamId, sUBI, network);

      // Get initial balance of sender
      const prevSenderBalance = await ubi.balanceOf(sender.address);

      // Move to the end of the stream
      await testUtils.goToMiddleOfStream(streamId, sUBI, network);
      // Get new balance
      const middleSenderBalance = await ubi.balanceOf(sender.address);
      const middleBlockTime = await testUtils.getCurrentBlockTime();

      // get the stream
      const stream = await sUBI.getStream(streamId);

      // Expect sender to have accrued the value of accruedPerSecond-delegatedPerSecond in half an hour
      expect(middleSenderBalance).to.eq(prevSenderBalance.add(accruedPerSecond.sub(delegatedPerSecond).mul(middleBlockTime - stream.startTime.toNumber())))

      // Transfer 1 UBI from account 0 to account 2
      const amountToBurn = ethers.utils.parseEther("1");
      await ubi.connect(sender).approve(recipient.address, amountToBurn); // +1 sec
      await ubi.connect(recipient).burnFrom(sender.address, amountToBurn); // +1 sec

      // New balance of sender should be prevBalance - 1 UBI (+2 secs (approve and transferFrom)
      const afterTransferSenderBalance = await ubi.balanceOf(sender.address);
      const expectedBalance = middleSenderBalance.sub(amountToBurn).add(accruedPerSecond.sub(delegatedPerSecond).mul(2));
      expect(afterTransferSenderBalance).to.eq(expectedBalance, "After burn, sender's balance should have decreased by 1 UBI (+1 sec of accruance)");

      // Move to end of stream
      await testUtils.goToEndOfStream(streamId, sUBI, network);

      // Get current blocktime
      const endBlockTime = await testUtils.getCurrentBlockTime();

      // Get the current stream balance
      const streamBalance = await sUBI.balanceOfStream(streamId);
      // Should be the delegatedPerSecond * stream duration
      expect(streamBalance).to.eq(delegatedPerSecond.mul(endBlockTime - stream.startTime.toNumber()))
      // Recipient withdraws balance 
      await ubi.connect(recipient).withdrawFromDelegations(sUBI.address, [streamId]);

      //  Get number of stream for the creator of stream 
      const lastStreamCount = await sUBI.getStreamsCount(sender.address);
      expect(lastStreamCount).to.eq(initialStreamCount, "Stream count should decrease after recipient withdraws from a completed stream");
    })

    it("happy path - subsequently transfering a stream NFT, when holder withdraws, should increase the correct balance on each recipient.", async () => {
      // ARRANGE
      const sUBI = await deploySUBI(ubi, accounts[0].address);
      const sender = accounts[0];
      const recipient = accounts[1];
      const recipient2 = accounts[2];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await ubi.startAccruing(sender.address);

      // Create a new stream with half accruedPerSecond
      const currentBlockTime = await testUtils.getCurrentBlockTime();
      const fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
      const toDate = moment(fromDate).add(1, "hour").toDate();

      // Hald accruedPerSecond
      const delegatedPerSecond = accruedPerSecond.div(2);

      // Create 1 stream with accruedPerSecond as the total.
      const streamId = await testUtils.createCancellableStream(sender, recipient.address, delegatedPerSecond, fromDate, toDate, ubi, sUBI);

      // Go to middle of stream and withdraw to current holder
      await testUtils.goToMiddleOfStream(streamId, sUBI, network);
      const prevBalance = await ubi.balanceOf(recipient.address);
      await ubi.withdrawFromDelegations(sUBI.address, [streamId]); //+ 1 sec
      const newBalance = await ubi.balanceOf(recipient.address);

      // calculate expected Accrued value (delegated per second * (elapsed time to middle of stream + 1 sec for withdraw))
      const expectedRecipient1AccruedValue = delegatedPerSecond * (((testUtils.dateToSeconds(toDate) - testUtils.dateToSeconds(fromDate)) / 2) + 1);

      // Assert correct balance
      expect(newBalance).to.eq(prevBalance + expectedRecipient1AccruedValue, "Invalid UBI value on recipient after withdraw from stream");

      // Current stream balance
      const streamBalance = await sUBI.balanceOfStream(streamId);
      expect(streamBalance).to.eq(0, "Stream balance should be 0 after withdraw");

      // Transfer stream to recipient 2
      await sUBI.connect(recipient).transferFrom(recipient.address, recipient2.address, streamId); //+ 1 sec

      // Get current UBI balance of recipient 2
      const recipient2PrevBalance = await ubi.balanceOf(recipient2.address);

      // Move to the end of stream
      await testUtils.goToEndOfStream(streamId, sUBI, network);

      // Withdraw from stream
      await ubi.withdrawFromDelegations(sUBI.address, [streamId]); //+ 1 sec

      // New recipient 2 balance
      const recipient2NewBalance = await ubi.balanceOf(recipient2.address);

      // Expected recipient accrued value should be stream total value - withdrawn value
      const expectedRecipient2AccruedValue = delegatedPerSecond * ((testUtils.dateToSeconds(toDate) - testUtils.dateToSeconds(fromDate))) - expectedRecipient1AccruedValue;
      expect(recipient2NewBalance).to.eq(recipient2PrevBalance + expectedRecipient2AccruedValue, "Invalid UBI value on recipient 2 after withdraw from stream");
    })

    it("happy path - Updating max streams allowed should update the value on the contract", async () => {
      const sUBI = await deploySUBI(ubi, accounts[0].address);
      await sUBI.connect(accounts[0]).setMaxStreamsAllowed(20);
      expect(await sUBI.maxStreamsAllowed()).to.eq(20);
    })

    it("happy path - withdraw from multiple strea should succesfully withdraw UBIs", async () => {
      // ARRANGE
      const sUBI = await deploySUBI(ubi, accounts[0].address);
      const sender = accounts[0];
      const recipient = accounts[1];
      const canceller = accounts[2];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      // Make sure canceller is not registered.
      await pohMockService.setSubmissionIsRegistered(mockPoh, canceller.address, false);
      await ubi.startAccruing(sender.address);

      // Create 3 streams, with one hour difference each
      const initialBlockTime = await testUtils.getCurrentBlockTime();
      // Stream starts at current blocktime + 1 hour
      const fromDate1 = moment(new Date(initialBlockTime * 1000)).add(1, "hours").toDate();
      const fromDate2 = moment(new Date(initialBlockTime * 1000)).add(2, "hours").toDate();
      const fromDate3 = moment(new Date(initialBlockTime * 1000)).add(3, "hours").toDate();
      // Stream lasts 1 hours
      const toDate1 = moment(fromDate1).add(1, "hour").toDate();
      const toDate2 = moment(fromDate2).add(1, "hour").toDate();
      const toDate3 = moment(fromDate3).add(1, "hour").toDate();

      // Create a stream from address 0 to address 1
      const streamId1 = await testUtils.createCancellableStream(sender, recipient.address, 1000, fromDate1, toDate1, ubi, sUBI);
      const streamId2 = await testUtils.createCancellableStream(sender, recipient.address, 1000, fromDate2, toDate2, ubi, sUBI);
      const streamId3 = await testUtils.createCancellableStream(sender, recipient.address, 1000, fromDate3, toDate3, ubi, sUBI);

      // Get initial recipient balance
      const prevRecipientBalance = await ubi.balanceOf(recipient.address);
      
      // Go to end of last stream
      await testUtils.goToEndOfStream(streamId3, sUBI, network);
      
      // ACT
      await ubi.withdrawFromDelegations(sUBI.address, [streamId1, streamId2, streamId3]);

      // ASSERT
      const newRecipientBalance = await ubi.balanceOf(recipient.address);
      expect(newRecipientBalance).to.eq(prevRecipientBalance.add(1000 * 3600 * 3));
    });
  });

  //// STREAM CANCELLATION
  describe("UBI Stream cancellation", () => {
    it("happy path - Cancelling a stream that has not started should lower the stream count from sender", async () => {

      // ARRANGE
      const sUBI = await deploySUBI(ubi, accounts[0].address);
      const sender = accounts[0];
      const recipient = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await ubi.startAccruing(sender.address);
      // Get stream count
      const initialStreamCount = await sUBI.getStreamsCount(sender.address);

      // Stream starts at current blocktime + 1 hour. Lasts 1 hour
      const initialBlockTime = await testUtils.getCurrentBlockTime();
      const fromDate = moment(new Date(initialBlockTime * 1000)).add(1, "hours").toDate();
      const toDate = moment(fromDate).add(1, "hour").toDate();

      // Create a stream from address 0 to address 1
      const streamId = await testUtils.createCancellableStream(sender, recipient.address, accruedPerSecond, fromDate, toDate, ubi, sUBI);

      // Move to start of the stream
      await testUtils.goToStartOfStream(streamId, sUBI, network);

      // Get stream count
      const nextStreamCount = await sUBI.getStreamsCount(sender.address);
      expect(nextStreamCount).to.eq(initialStreamCount.add(1), "Stream count should increase when a stream is created");

      // Cancel the stream
      await ubi.connect(accounts[0]).cancelDelegation(sUBI.address, streamId);

      // Get stream count. It should be equal to the previous count.
      const lastStreamCount = await sUBI.getStreamsCount(sender.address);
      expect(lastStreamCount).to.eq(initialStreamCount, "Stream count should decrease after a stream is cancelled");
    });

    it("happy path - Cancelling a stream that has already started should lower the stream count from sender", async () => {

      // ARRANGE
      const sUBI = await deploySUBI(ubi, accounts[0].address);
      const sender = accounts[0];
      const recipient = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await ubi.startAccruing(sender.address);

      // Get stream count
      const initialStreamCount = await sUBI.getStreamsCount(sender.address);

      const initialBlockTime = await testUtils.getCurrentBlockTime();
      // Stream starts at current blocktime + 1 hour
      const fromDate = moment(new Date(initialBlockTime * 1000)).add(1, "hours").toDate();
      // Stream lasts 1 hours
      const toDate = moment(fromDate).add(1, "hour").toDate();

      // Create a stream from address 0 to address 1
      const streamId = await testUtils.createCancellableStream(sender, recipient.address, accruedPerSecond, fromDate, toDate, ubi, sUBI);

      // Move blocktime to the middle of the stream
      await testUtils.goToMiddleOfStream(streamId, sUBI, network);

      // Get stream count
      const nextStreamCount = await sUBI.getStreamsCount(sender.address);
      expect(nextStreamCount).to.eq(initialStreamCount.add(1), "Stream count should increase when a stream is created");

      // Cancel the stream
      await ubi.connect(sender).cancelDelegation(sUBI.address, streamId);

      // Get stream count. It should be equal to the previous count.
      const lastStreamCount = await sUBI.getStreamsCount(sender.address);
      expect(lastStreamCount).to.eq(initialStreamCount, "Stream count should decrease after a stream is cancelled");
    });

    it("happy path - Cancelling a stream that already started should delete the streamId from the list of streamIds of the sender.", async () => {

      // ARRANGE
      const sUBI = await deploySUBI(ubi, accounts[0].address);
      const sender = accounts[0];
      const recipient = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await ubi.startAccruing(sender.address);

      const initialBlockTime = await testUtils.getCurrentBlockTime();
      // Stream starts at current blocktime + 1 hour
      const fromDate = moment(new Date(initialBlockTime * 1000)).add(1, "hours").toDate();
      // Stream lasts 1 hours
      const toDate = moment(fromDate).add(1, "hour").toDate();

      // Create a stream from address 0 to address 1
      const streamId = await testUtils.createCancellableStream(sender, recipient.address, accruedPerSecond, fromDate, toDate, ubi, sUBI);

      // Get stream ids of sender
      const streamIds = await sUBI.getStreamsOf(sender.address);
      expect(streamIds.find(itmStreamId => itmStreamId.toNumber() === streamId.toNumber()) !== undefined, "Newly created stream id not found on list of sender's streamIds");

      // Move blocktime to the middle of the stream
      await testUtils.goToMiddleOfStream(streamId, sUBI, network);

      // Cancel the stream
      await ubi.connect(sender).cancelDelegation(sUBI.address, streamId);
      const newStreamIds = await sUBI.getStreamsOf(sender.address);

      // Check that last stream id does not exists
      expect(newStreamIds.find(itmStreamId => itmStreamId.toNumber() === streamId.toNumber()) === undefined, "Cancelled stream should not be on the list of sender's streamIds");
    });

    it("happy path - Cancelling a stream before it starts should not impact on sender accruance", async () => {

      // ARRANGE
      const sUBI = await deploySUBI(ubi, accounts[0].address);
      const sender = accounts[0];
      const recipient = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await ubi.startAccruing(sender.address);

      const initialBlockTime = await testUtils.getCurrentBlockTime();
      // Stream starts at current blocktime + 1 hour
      const fromDate = moment(new Date(initialBlockTime * 1000)).add(1, "hours").toDate();
      // Stream lasts 1 hours
      const toDate = moment(fromDate).add(1, "hour").toDate();

      // Create a stream from address 0 to address 1
      const streamId = await testUtils.createCancellableStream(sender, recipient.address, accruedPerSecond, fromDate, toDate, ubi, sUBI);

      // Get previous Stream balance
      const prevStreamBalance = await sUBI.balanceOfStream(streamId);
      expect(prevStreamBalance).to.eq(0, "Initial stream balance should be 0");

      // Get stream
      const stream = await sUBI.getStream(streamId);

      const prevRecipientBalance = await ubi.balanceOf(recipient.address);

      // Move to 1 second before the start of the stream.
      await testUtils.setNextBlockTime(stream.startTime.toNumber() - 1, network);

      // Get starting Stream balance
      const startingStreamBalance = await sUBI.balanceOfStream(streamId.toString());
      expect(startingStreamBalance.toNumber()).to.eq(0, "Stream balance at start time should be 0");

      // Get a snapshot of the initial sender balance
      const initialSenderSnapshot = {
        balance: await ubi.balanceOf(sender.address),
        timestamp: await testUtils.getCurrentBlockTime()
      }


      // Cancel the stream (mines a block so consolidated balance will add +1 sec of ubi to the stream)
      await ubi.connect(sender).cancelDelegation(sUBI.address, streamId);
      const recipientBalanceAfterCancel = await ubi.balanceOf(recipient.address);
      expect(recipientBalanceAfterCancel).to.eq(prevRecipientBalance, "Recipient balance should not change if cancelled stream did not start");

      // Move to end of the stream
      await testUtils.goToEndOfStream(streamId, sUBI, network);

      // After 1 hour (and 1 second of the mined block on cancel), Human should have accrued 1  UBI
      const currentSenderBalance = await ubi.balanceOf(sender.address);
      const expectedSenderBalance = initialSenderSnapshot.balance.add(accruedPerSecond.mul((stream.stopTime.toNumber() - initialSenderSnapshot.timestamp)));
      expect(currentSenderBalance).to.eq(expectedSenderBalance, "Human balance should normally accrue after cancelling a stream that didnt start");

      // Stream should not exist
      expect(await sUBI.balanceOfStream(streamId)).to.eq(0, "Stream balance should be 0 after cancelling a stream that didn't start");
    });

    it("happy path - Cancelling right at the middle of a stream should withdraw the stream accrued balance to the recipient", async () => {

      // ARRANGE
      const sUBI = await deploySUBI(ubi, accounts[0].address);
      const sender = accounts[0];
      const recipient = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await ubi.startAccruing(sender.address);

      const initialBlockTime = await testUtils.getCurrentBlockTime();
      // Stream starts at current blocktime + 1 hour
      const fromDate = moment(new Date(initialBlockTime * 1000)).add(1, "hours").toDate();
      // Stream lasts 1 hours
      const toDate = moment(fromDate).add(1, "hour").toDate();

      // Create a stream from address 0 to address 1
      const streamId = await testUtils.createCancellableStream(sender, recipient.address, accruedPerSecond, fromDate, toDate, ubi, sUBI);

      // Get previous Stream balance
      const prevStreamBalance = await sUBI.balanceOfStream(streamId);
      expect(prevStreamBalance).to.eq(0, "Initial stream balance should be 0");

      // Move to start of the stream
      await testUtils.goToStartOfStream(streamId, sUBI, network);

      // Get previous human
      const prevHumanBalance = await ubi.balanceOf(sender.address);
      // Get previous recipient balance 
      const prevRecipientBalance = await ubi.balanceOf(recipient.address);

      // Move blocktime to the middle of the stream
      await testUtils.goToMiddleOfStream(streamId, sUBI, network);

      // Get previous recipient balance 
      const middleStreamBalance = await sUBI.balanceOfStream(streamId);

      // Cancel the stream (mines block and moves blocktime 1 second)
      await ubi.connect(sender).cancelDelegation(sUBI.address, streamId);

      // After 30 minutes, stream recipient should have accrued 0.5 UBI
      const newRecipientBalance = await ubi.balanceOf(recipient.address);
      expect(newRecipientBalance).to.eq(prevRecipientBalance.add(middleStreamBalance.add(accruedPerSecond)), "Recipient balance should increase by 0.5 UBI after cancelling stream running half an hour");

      // After 30 minutes, Human should have accrued 1 secnd of UBI (because of the mined block on cancel stream)
      const currHumanBalance = await ubi.balanceOf(sender.address);
      expect(currHumanBalance).to.eq(prevHumanBalance, "Human balance should not accrue while streaming all its accruedPerSecond.");

    });

    it("happy path - when reportRemoval is executed, all existing and future streams should cancel and canceller balance should increase ", async () => {
      // ARRANGE
      const sUBI = await deploySUBI(ubi, accounts[0].address);
      const sender = accounts[0];
      const recipient = accounts[1];
      const canceller = accounts[2];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      // Make sure canceller is not registered.
      await pohMockService.setSubmissionIsRegistered(mockPoh, canceller.address, false);
      await ubi.startAccruing(sender.address);

      // Create 3 streams, with one hour difference each
      const initialBlockTime = await testUtils.getCurrentBlockTime();
      // Stream starts at current blocktime + 1 hour
      const fromDate1 = moment(new Date(initialBlockTime * 1000)).add(1, "hours").toDate();
      const fromDate2 = moment(new Date(initialBlockTime * 1000)).add(2, "hours").toDate();
      const fromDate3 = moment(new Date(initialBlockTime * 1000)).add(3, "hours").toDate();
      // Stream lasts 1 hours
      const toDate1 = moment(fromDate1).add(1, "hour").toDate();
      const toDate2 = moment(fromDate2).add(1, "hour").toDate();
      const toDate3 = moment(fromDate3).add(1, "hour").toDate();

      // Create a stream from address 0 to address 1
      const streamId1 = await testUtils.createCancellableStream(sender, recipient.address, 1000, fromDate1, toDate1, ubi, sUBI);
      const streamId2 = await testUtils.createCancellableStream(sender, recipient.address, 1000, fromDate2, toDate2, ubi, sUBI);
      const streamId3 = await testUtils.createCancellableStream(sender, recipient.address, 1000, fromDate3, toDate3, ubi, sUBI);

      // Move to the middle of first stream
      await testUtils.goToMiddleOfStream(streamId1, sUBI, network);
      const prevCancellerBalance = await ubi.balanceOf(canceller.address);

      // ACT
      // Unregister human and report removal of UBI
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, false);
      await ubi.connect(canceller).reportRemoval(sender.address);


      // ASSERT
      // Assert no active streams
      const activeStreams = await sUBI.getActiveStreamsOf(sender.address);
      expect(activeStreams.length).to.eq(0, "There should be no active streams after reportRemoval");
      // assert canceller balance increased
      const newCancellerBalance = await ubi.balanceOf(canceller.address);
      expect(newCancellerBalance).to.be.gt(prevCancellerBalance);
    });

    it("fail path - canceling a non-cancelable stream should revert", async () => {
      // ARRANGE
      const sUBI = await deploySUBI(ubi, accounts[0].address);
      const sender = accounts[0];
      const recipient = accounts[1];
      await pohMockService.setSubmissionIsRegistered(mockPoh, sender.address, true);
      await ubi.startAccruing(sender.address);

      // Create 3 streams, with one hour difference each
      const initialBlockTime = await testUtils.getCurrentBlockTime();
      // Stream starts at current blocktime + 1 hour
      const fromDate1 = moment(new Date(initialBlockTime * 1000)).add(1, "hours").toDate();
      // Stream lasts 1 hours
      const toDate1 = moment(fromDate1).add(1, "hour").toDate();

      // Create a stream from address 0 to address 1
      const streamId1 = await testUtils.createNonCancellableStream(sender, recipient.address, 1000, fromDate1, toDate1, ubi, sUBI);

      // ACT && ASSERT
      await expect(ubi.cancelDelegation(sUBI.address, streamId1)).to.be.revertedWith("stream not cancellable");
    });
  });

  describe("accruedTime related tests", () => {

    let sUBI;
    beforeEach(async () => {
      sUBI = await deploySUBI(ubi, accounts[0].address);
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
      const lastStreamId = await testUtils.createCancellableStream(sender,
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
      const lastStreamId = await testUtils.createCancellableStream(sender,
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
      const lastStreamId = await testUtils.createCancellableStream(sender,
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
      const lastStreamId = await testUtils.createCancellableStream(sender,
        recipient.address,
        100,
        fromDate,
        toDate,
        ubi, sUBI);

      // ACT
      // move to middle of stream
      await testUtils.goToMiddleOfStream(lastStreamId, sUBI, network);
      // widthdraw from stream
      await ubi.withdrawFromDelegations(sUBI.address, [lastStreamId]);

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
      const lastStreamId = await testUtils.createCancellableStream(sender,
        recipient.address,
        100,
        fromDate,
        toDate,
        ubi, sUBI);

      // ACT
      // move to middle of stream
      await testUtils.goToMiddleOfStream(lastStreamId, sUBI, network);
      // widthdraw from stream
      await ubi.withdrawFromDelegations(sUBI.address, [lastStreamId]);
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
      const lastStreamId = await testUtils.createCancellableStream(sender,
        recipient.address,
        100,
        fromDate,
        toDate,
        ubi, sUBI);

      // ACT
      // Set block time to end of stream
      await testUtils.goToEndOfStream(lastStreamId, sUBI, network);
      // widthdraw from stream
      await ubi.withdrawFromDelegations(sUBI.address, [lastStreamId]);

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
      const lastStreamId = await testUtils.createCancellableStream(sender, recipient.address, accruedPerSecond.toNumber(), fromDate, toDate, ubi, sUBI);
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
      sUBI = await deploySUBI(ubi, accounts[0].address);
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
          await testUtils.createCancellableStream(sender, recipient.address, 100, fromDate, toDate, ubi, sUBI);

          // ASSERT 
          // Check that delegated accrued value returns 0 (because stream didnt start). 
          expect((await sUBI.outgoingTotalAccruedValue(sender.address)).toNumber()).to.eq(0);
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
          const lastStreamId = await testUtils.createCancellableStream(sender, recipient.address, 100, fromDate, toDate, ubi, sUBI);

          // ACT
          // Set block time to middle of stream
          await testUtils.goToMiddleOfStream(lastStreamId, sUBI, network);

          // ASSERT 
          // Check that delegated accrued value returns 180000.
          expect((await sUBI.outgoingTotalAccruedValue(sender.address)).toNumber()).to.eq(180000);
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
          const lastStreamId = await testUtils.createCancellableStream(sender, recipient.address, 100, fromDate, toDate, ubi, sUBI);

          // ACT
          // Set block time to startTime + 200
          await testUtils.goToEndOfStream(lastStreamId, sUBI, network);

          // ASSERT 
          // Check that delta of returns 200.
          expect((await sUBI.outgoingTotalAccruedValue(sender.address)).toNumber()).to.eq(360000);
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
          const lastStreamId = await testUtils.createCancellableStream(sender, recipient.address, 100, fromDate, toDate, ubi, sUBI);
          // move to middle of stream
          await testUtils.goToMiddleOfStream(lastStreamId, sUBI, network);

          // ACT
          // widthdraw from stream
          await ubi.withdrawFromDelegations(sUBI.address, [lastStreamId]);

          // ASSERT 
          // Check that getDelegatedAccruedValue of returns 0.
          expect((await sUBI.outgoingTotalAccruedValue(sender.address)).toNumber()).to.eq(0);
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
          const lastStreamId = await testUtils.createCancellableStream(sender, recipient.address, 100, fromDate, toDate, ubi, sUBI);
          // move to middle of stream
          await testUtils.goToMiddleOfStream(lastStreamId, sUBI, network);
          // widthdraw from stream
          await ubi.withdrawFromDelegations(sUBI.address, [lastStreamId]);

          // ACT           
          // Go to end of stream,
          await testUtils.goToEndOfStream(lastStreamId, sUBI, network);

          // ASSERT 
          // Check that getDelegatedAccruedValue return 179900 (because withdraw from stream moves 1 secon further).
          expect((await sUBI.outgoingTotalAccruedValue(sender.address)).toNumber()).to.eq(179900);
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
          const lastStreamId = await testUtils.createCancellableStream(sender, recipient.address, 100, fromDate, toDate, ubi, sUBI);
          // move to middle of stream
          await testUtils.goToMiddleOfStream(lastStreamId, sUBI, network);

          // ACT           
          // Go to end of stream,
          await testUtils.goToEndOfStream(lastStreamId, sUBI, network);
          // widthdraw from stream
          await ubi.withdrawFromDelegations(sUBI.address, [lastStreamId]);

          // ASSERT 
          // Check that getDelegatedAccruedValue return 179900 (because withdraw from stream moves 1 secon further).
          expect((await sUBI.outgoingTotalAccruedValue(sender.address)).toNumber()).to.eq(0);
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
          await testUtils.createCancellableStream(sender, recipient1.address, 100, fromDate1, toDate1, ubi, sUBI);
          await testUtils.createCancellableStream(sender, recipient2.address, 100, fromDate2, toDate2, ubi, sUBI);

          // ASSERT 
          // Check that delta of return 0 (because streams didnt start). 
          expect((await sUBI.outgoingTotalAccruedValue(sender.address)).toNumber()).to.eq(0);
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
          const streamId1 = await testUtils.createCancellableStream(sender, recipient1.address, 100, fromDate1, toDate1, ubi, sUBI);
          await testUtils.createCancellableStream(sender, recipient2.address, 100, fromDate2, toDate2, ubi, sUBI);

          // ACT
          // ARRANGE / ACT
          // Set block time to middle of first stream
          await testUtils.goToMiddleOfStream(streamId1, sUBI, network);

          // ASSERT 
          // Check that getDelegatedAccruedValue returns 180000 UBIwei
          expect((await sUBI.outgoingTotalAccruedValue(sender.address)).toNumber()).to.eq(180000);
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
          await testUtils.createCancellableStream(sender, recipient1.address, 100, fromDate1, toDate1, ubi, sUBI);
          const streamId2 = await testUtils.createCancellableStream(sender, recipient2.address, 100, fromDate2, toDate2, ubi, sUBI);

          // ACT
          // Set block time to end of second stream
          await testUtils.goToMiddleOfStream(streamId2, sUBI, network);

          // ASSERT 
          // Check that delta of returns 360000 + 180000.
          expect((await sUBI.outgoingTotalAccruedValue(sender.address)).toNumber()).to.eq(360000 + 180000);
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
          await testUtils.createCancellableStream(sender, recipient1.address, 100, fromDate1, toDate1, ubi, sUBI);
          const streamId2 = await testUtils.createCancellableStream(sender, recipient2.address, 100, fromDate2, toDate2, ubi, sUBI);

          // ARRANGE & ACT                
          // Set block time to end of second stream
          await testUtils.goToEndOfStream(streamId2, sUBI, network);

          // ASSERT 
          // Check that delta of returns 360000 + 360000.
          expect((await sUBI.outgoingTotalAccruedValue(sender.address)).toNumber()).to.eq(360000 + 360000);
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
          const streamId1 = await testUtils.createCancellableStream(sender, recipient1.address, 100, fromDate1, toDate1, ubi, sUBI);
          await testUtils.createCancellableStream(sender, recipient2.address, 100, fromDate2, toDate2, ubi, sUBI);

          // ACT
          // Move to middle of 1st stream
          await testUtils.goToMiddleOfStream(streamId1, sUBI, network);
          // Withdraw from 1st stream
          await ubi.withdrawFromDelegations(sUBI.address, [streamId1]);

          // ASSERT 
          // getDelegatedAccruedValue should return 0
          expect((await sUBI.outgoingTotalAccruedValue(sender.address)).toNumber()).to.eq(0);
        })


        it("happy path - creating 2 streams, with 30 minutes of difference, moving to middle of 1st and withdrawing, and then moving to the middle of stream 2, in which first stream is finished, sum of both streams should return 180000 + 179900 UBIwei.", async () => {
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
          const streamId1 = await testUtils.createCancellableStream(sender, recipient1.address, 100, fromDate1, toDate1, ubi, sUBI);
          const streamId2 = await testUtils.createCancellableStream(sender, recipient2.address, 100, fromDate2, toDate2, ubi, sUBI);

          // Move to middle of 1st stream
          await testUtils.goToMiddleOfStream(streamId1, sUBI, network);
          // Withdraw from 1st stream
          await ubi.withdrawFromDelegations(sUBI.address, [streamId1]);


          // ACT         
          // Go to end of stream 2,
          await testUtils.goToMiddleOfStream(streamId2, sUBI, network);
          const stream1Balance = await sUBI.balanceOfStream(streamId1);
          const stream2Balance = await sUBI.balanceOfStream(streamId2);

          // ASSERT 
          // Check that getDelegatedAccruedValue returns 180000 + 180000 (because withdraw from stream moves 1 second further).
          expect(stream1Balance.add(stream2Balance)).to.eq(179900 + 180000);

        })

        it("happy path - creating 2 streams, with 30 minutes of difference, moving to the middle of stream 2, and withdrawing from stream 2, sum of both streams should return 360000 + 0 UBIwei.", async () => {

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
          const streamId1 = await testUtils.createCancellableStream(sender, recipient1.address, 100, fromDate1, toDate1, ubi, sUBI);
          const streamId2 = await testUtils.createCancellableStream(sender, recipient2.address, 100, fromDate2, toDate2, ubi, sUBI);

          // ACT                
          // Go to end of stream 2,
          await testUtils.goToMiddleOfStream(streamId2, sUBI, network);
          // Withdraw from stream 2
          await ubi.withdrawFromDelegations(sUBI.address, [streamId2]);

          const stream1Balance = await sUBI.balanceOfStream(streamId1);
          const stream2Balance = await sUBI.balanceOfStream(streamId2);

          // ASSERT 
          // Check that getDelegatedAccruedValue returns 179900 + 0 (because withdraw from stream moves 1 secon further).
          expect(stream1Balance.add(stream2Balance)).to.eq(360000 + 0);
        })

      })
    })
  })

});
