const { default: BigNumber } = require("bignumber.js");
const { expect } = require("chai");
const deploymentParams = require('../deployment-params');
const testUtils = require("./testUtils");
const moment = require("moment");

const ONE_HOUR = 3600;
const TWO_HOURS = 3600 * 2;

/**
 @summary Tests for UBI.sol
*/
contract('UBI.sol', accounts => {
  describe('UBI Coin and Proof of Humanity', () => {
    before(async () => {
      accounts = await ethers.getSigners();

      [_addresses, mockProofOfHumanity, mockPoster] = await Promise.all([
        Promise.all(accounts.map((account) => account.getAddress())),
        waffle.deployMockContract(
          accounts[0],
          require("../artifacts/contracts/UBI.sol/IProofOfHumanity.json").abi
        ),
        waffle.deployMockContract(
          accounts[9],
          require("../artifacts/contracts/UBI.sol/IPoster.json").abi
        ),
      ]);
      setSubmissionIsRegistered = (submissionID, isRegistered) =>
        mockProofOfHumanity.mock.isRegistered
          .withArgs(submissionID)
          .returns(isRegistered);
      setPost = (content) =>
        mockPoster.mock.post
          .withArgs(content)
          .returns();

      setSubmissionInfo = (submissionID, info) => {
        mockProofOfHumanity.mock.getSubmissionInfo
          .withArgs(submissionID)
          .returns({
            submissionTime: info.submissionTime
          });
      }

      addresses = _addresses;

      UBICoin = await ethers.getContractFactory("UBI");

      ubi = await upgrades.deployProxy(UBICoin,
        [deploymentParams.INITIAL_SUPPLY, deploymentParams.TOKEN_NAME, deploymentParams.TOKEN_SYMBOL, deploymentParams.ACCRUED_PER_SECOND, mockProofOfHumanity.address],
        { initializer: 'initialize', unsafeAllowCustomTypes: true }
      );

      const mockAddress = mockPoster.address;
      await ubi.deployed();

      altProofOfHumanity = await waffle.deployMockContract(accounts[0], require("../artifacts/contracts/UBI.sol/IProofOfHumanity.json").abi);
      altPoster = mockAddress;

      ubiPerSecond = BigNumber((await ubi.getAccruedPerSecond()).toString());

      // Set zero address as not registered
      setSubmissionIsRegistered(ethers.constants.AddressZero, false);
    });

    describe("UBI basic use cases", () => {

      it("happy path - return a value previously initialized.", async () => {
        // Check that the value passed to the constructor is set.
        expect((await ubi.accruedPerSecond()).toString()).to.equal(deploymentParams.ACCRUED_PER_SECOND.toString());
      });

      it("happy path - check that the initial `accruedSince` value is 0.", async () => {
        expect((await ubi.accruedSince(addresses[1])).toString()).to.equal('0');
      });

      it("require fail - The submission is not registered in Proof Of Humanity.", async () => {
        // Make sure it reverts if the submission is not registered.
        await setSubmissionIsRegistered(addresses[1], false);
        await expect(
          ubi.startAccruing(addresses[1])
        ).to.be.revertedWith(
          "The submission is not registered in Proof Of Humanity."
        );
      });

      it("happy path - allow registered submissions to start accruing UBI.", async () => {
        // Start accruing UBI and check that the current block number was set.
        await setSubmissionIsRegistered(addresses[1], true);
        await ubi.startAccruing(addresses[1]);
        const accruedSince = await ubi.accruedSince(addresses[1]);
        expect((await ubi.accruedSince(addresses[1])).toString()).to.equal(
          accruedSince.toString()
        );
      });

      it("require fail - The submission is already accruing UBI.", async () => {
        // Make sure it reverts if you try to accrue UBI while already accruing UBI.
        await expect(
          ubi.startAccruing(addresses[1])
        ).to.be.revertedWith("The submission is already accruing UBI.");
      });

      it("happy path - a submission removed from Proof of Humanity no longer accrues value.", async () => {
        await network.provider.send("evm_increaseTime", [7200]);
        await network.provider.send("evm_mine");
        await setSubmissionIsRegistered(addresses[1], false);
        await network.provider.send("evm_increaseTime", [3600]);
        await network.provider.send("evm_mine");
        expect((await testUtils.ubiBalanceOfWallet(addresses[1], ubi)).toString()).to.equal('0');
      });

      it("happy path - a submission with interrupted accruing still keeps withdrawn coins.", async () => {
        await ubi.transfer(addresses[1], 555);
        await setSubmissionIsRegistered(addresses[1], true);
        await network.provider.send("evm_increaseTime", [7200]);
        await network.provider.send("evm_mine");
        await setSubmissionIsRegistered(addresses[1], false);
        await network.provider.send("evm_increaseTime", [7200]);
        await network.provider.send("evm_mine");
        expect((await testUtils.ubiBalanceOfWallet(addresses[1], ubi)).toString()).to.equal('555');
      });

      it("happy path - a submission that natively accrued keeps transfered coins upon interruption.", async () => {
        await setSubmissionIsRegistered(accounts[3].address, true);
        expect((await testUtils.ubiBalanceOfWallet(addresses[3], ubi)).toString()).to.equal('0');
        await ubi.startAccruing(accounts[3].address);
        await network.provider.send("evm_increaseTime", [7200]);
        await network.provider.send("evm_mine");
        await ubi.connect(accounts[3]).transfer(addresses[1], 55);
        expect((await testUtils.ubiBalanceOfWallet(addresses[1], ubi)).toString()).to.equal('610');
      });

      it("happy path - check that Mint and Transfer events get called when it corresponds.", async () => {
        const owner = accounts[9];
        const initialBalance = await testUtils.ubiBalanceOfWallet(owner.address, ubi);
        await setSubmissionIsRegistered(owner.address, true);
        await ubi.startAccruing(owner.address);
        await network.provider.send("evm_increaseTime", [1]);
        await network.provider.send("evm_mine");
        expect(await testUtils.ubiBalanceOfWallet(owner.address, ubi)).to.be.above(initialBalance);
        await expect(ubi.connect(owner).transfer(addresses[8], 18000))
          .to.emit(ubi, "Transfer")
        await expect(ubi.connect(owner).burn('199999999966000'))
          .to.emit(ubi, "Transfer")
        await setSubmissionIsRegistered(owner.address, false);
        await expect(ubi.connect(owner).burn('100000000000000'))
          .to.emit(ubi, "Transfer")
        expect(await testUtils.ubiBalanceOfWallet(owner.address, ubi)).to.be.at.least(3000);
      });

      it("require fail - The submission is still registered in Proof Of Humanity.", async () => {
        // Make sure it reverts if the submission is still registered.
        await setSubmissionIsRegistered(addresses[6], true);
        await ubi.startAccruing(addresses[6]);
        await expect(
          ubi.reportRemoval(addresses[6])
        ).to.be.revertedWith(
          "The submission is still registered in Proof Of Humanity."
        );
      });

      it("happy path - allows anyone to report a removed submission for their accrued UBI.", async () => {
        // Report submission and verify that `accruingSinceBlock` was reset.
        // Also verify that the accrued UBI was sent correctly.
        await ubi.accruedSince(addresses[1]);
        await ubi.reportRemoval(addresses[1]);
        expect((await ubi.accruedSince(addresses[1])).toString()).to.equal('0');
      });

      it("happy path - returns 0 for submissions that are not accruing UBI.", async () => {
        expect((await ubi.getAccruedValue(addresses[5])).toString()).to.equal('0');
      });

      it("happy path - allow governor to change `proofOfHumanity`.", async () => {
        // Make sure it reverts if we are not the governor.
        await expect(
          ubi.connect(accounts[1]).changeProofOfHumanity(altProofOfHumanity.address)
        ).to.be.revertedWith("The caller is not the governor.");

        // Set the value to an alternative proof of humanity registry
        const originalProofOfHumanity = await ubi.proofOfHumanity();
        await ubi.changeProofOfHumanity(altProofOfHumanity.address);
        expect(await ubi.proofOfHumanity()).to.equal(altProofOfHumanity.address);
        expect(await ubi.proofOfHumanity()).to.not.equal(originalProofOfHumanity);

        await ubi.changeProofOfHumanity(originalProofOfHumanity)
      });

      it("happy path - allow to burn and post.", async () => {
        await setSubmissionIsRegistered(addresses[0], true);
        await setPost('hello world');
        const previousBalance = new BigNumber((await testUtils.ubiBalanceOfWallet(addresses[0], ubi)).toString());
        await ubi.burnAndPost(ethers.utils.parseEther("0.01"), altPoster, 'hello world');
        const newBalance = new BigNumber((await testUtils.ubiBalanceOfWallet(addresses[0], ubi)).toString());
        expect(newBalance.toNumber()).to.lessThan(previousBalance.toNumber());
      });
    });
  });

  describe("UBI streams", () => {

    let lastStreamId;
    before(async () => {
      // Restore original PoH
      await ubi.changeProofOfHumanity(mockProofOfHumanity.address);

      setSubmissionIsRegistered(addresses[0], true);
      setSubmissionIsRegistered(addresses[1], false);
      await ubi.startAccruing(addresses[0]);
    });

    it("require fail - Creating stream of UBI per second higher than UBI.accruedPerSecond should fail.", async () => {
      setSubmissionIsRegistered(addresses[0], true);
      setSubmissionIsRegistered(addresses[1], false);

      const currentBlockTime = await testUtils.getCurrentBlockTime();
      // Stream starts at current blocktime + 10 minutes
      const fromDate = moment(new Date(currentBlockTime * 1000)).add(10, "minutes").toDate();
      // Stream lasts for 1 hour
      const toDate = moment(fromDate).add(1, "hour").toDate();

      // Get the value of accruedPerSecond
      const accruedPerSecond = BigNumber((await ubi.getAccruedPerSecond()).toString());

      // Generate invalid payment per second
      const newStreamPaymentPerSecond = accruedPerSecond.plus(1);

      // try to create stream with a value lower should revert
      await expect(testUtils.createStream(accounts[0], addresses[1], newStreamPaymentPerSecond.toNumber(), fromDate, toDate, ubi))
        .to.be.revertedWith("Cannot delegate a value higher than accruedPerSecond");
    });

    it("happy path - After creating a stream that starts in the future, human should accrue UBI until stream starts.", async () => {
      setSubmissionIsRegistered(accounts[0].address, true);
      setSubmissionIsRegistered(addresses[1], false);

      const initialBlockTime = await testUtils.getCurrentBlockTime();
      // Stream starts at current blocktime + 1 hour
      const fromDate = moment(new Date(initialBlockTime * 1000)).add(1, "hours").toDate();
      // Stream lasts 2 hours
      const toDate = moment(fromDate).add(2, "hour").toDate();

      // Create a stream from address 0 to address 1
      const ubiPerSecond = BigNumber((await ubi.getAccruedPerSecond()).toString());
      // try to create stream with a value lower should revert
      lastStreamId = await testUtils.createStream(accounts[0], addresses[1], ubiPerSecond.toNumber(), fromDate, toDate, ubi);
      const blockTimeAfterStreamCreation = await testUtils.getCurrentBlockTime();

      // Get previous human balance 
      const prevHumanBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[0], ubi)).toString());

      // Get previous Stream balance
      const prevStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId.toString(), addresses[1], ubi)).toString())
      expect(prevStreamBalance.toNumber()).to.eq(0, "Initial stream balance should be 0");

      // Get stream
      const stream = await ubi.getStream(lastStreamId);

      // Move blocktime to the start of the stream
      const currentBlockTime = await testUtils.getCurrentBlockTime();
      if (currentBlockTime < stream.startTime.toNumber()) {
        await testUtils.setNextBlockTime(stream.startTime.toNumber(), network);
      }
      const newBlockTime = await testUtils.getCurrentBlockTime();
      expect(newBlockTime).to.eq(stream.startTime.toNumber(), "Expected blocktime to be the start of the stream");

      // Get current human balance 
      const currHumanBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[0], ubi)).toString());
      expect(currHumanBalance.toNumber()).to.eq(prevHumanBalance.plus(ubiPerSecond.multipliedBy(newBlockTime - blockTimeAfterStreamCreation)).toNumber(), "Human balance ");

      const currentStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId.toString(), addresses[1], ubi)).toString())
      expect(currentStreamBalance.toNumber()).to.eq(0, "Current stream balance should still be 0");

    });

    it("require fail - Creating a stream from a non registered account should fail.", async () => {
      setSubmissionIsRegistered(addresses[1], false);
      // Stream from NOW until the next 1 hour
      const currentBlockTime = await testUtils.getCurrentBlockTime();

      const fromDate = moment(new Date(currentBlockTime * 1000)).add(10, "minutes").toDate();
      const toDate = moment(fromDate).add(1, "hour").toDate();

      // Get accrued per second
      const ubiPerSecond = BigNumber((await ubi.getAccruedPerSecond()).toString());

      // try to create stream with a value lower should revert
      await expect(testUtils.createStream(accounts[0], addresses[1], ubiPerSecond.toNumber(), fromDate, toDate, ubi))
        .to.be.revertedWith("Account is already a recipient on an active stream.");
    });

    it("require fail - Creating stream to an existing valid stream recipient should fail.", async () => {
      setSubmissionIsRegistered(addresses[0], true);
      setSubmissionIsRegistered(addresses[1], false);

      // Stream from NOW until the next 1 hour
      const currentBlockTime = await testUtils.getCurrentBlockTime();

      const fromDate = moment(new Date(currentBlockTime * 1000)).add(10, "minutes").toDate();
      const toDate = moment(fromDate).add(1, "hour").toDate();

      // Get accrued per second
      const ubiPerSecond = BigNumber((await ubi.getAccruedPerSecond()).toString());

      // try to create stream with a value lower should revert
      await expect(testUtils.createStream(accounts[0], addresses[1], ubiPerSecond.toNumber(), fromDate, toDate, ubi))
        .to.be.revertedWith("Account is already a recipient on an active stream.");
    });

    it("happy path - While stream with full accruedPerSecond delegation is active, human should not accrue any UBI and stream should accrue.", async () => {
      setSubmissionIsRegistered(accounts[0].address, true);
      setSubmissionIsRegistered(addresses[1], false);

      // Create a stream from address 0 to address 1
      const ubiPerSecond = BigNumber((await ubi.getAccruedPerSecond()).toString());

      // get the original stream
      const stream = await ubi.getStream(lastStreamId);

      // Move blocktime to the start of the stream
      const currentBlockTime = await testUtils.getCurrentBlockTime();
      if (currentBlockTime < stream.startTime) {
        await testUtils.setNextBlockTime(stream.startTime.toNumber(), network);
        const newBlockTime = await testUtils.getCurrentBlockTime();
        expect(newBlockTime).to.eq(stream.startTime.toNumber(), "Expected blocktime to be the start of the stream");
      }

      // Get previous human balance 
      const prevHumanBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[0], ubi)).toString());
      // Get previous Stream balance
      const prevStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId, addresses[1], ubi)).toString())

      // Move block time to the end of the stream
      const nextBlockTime = await testUtils.getCurrentBlockTime();
      if (nextBlockTime < stream.stopTime.toNumber()) {
        await testUtils.setNextBlockTime(stream.stopTime.toNumber(), network);
        const lastBlockTime = await testUtils.getCurrentBlockTime();
        expect(lastBlockTime).to.eq(stream.stopTime.toNumber(), "Expected blocktime to be the end of the stream");
      }

      // Get current human balance 
      const currHumanBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[0], ubi)).toString());
      // Get current Stream balance
      const currStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId, addresses[1], ubi)).toString())

      // Human should have accrued the balance of 1 hour
      expect(currHumanBalance.toNumber()).to.eq(prevHumanBalance.toNumber(), "Human should not increase balance after delegating all UBIs per second");
      // Stream should have accrued the balance of 1 hour
      const lastBlockTime = await testUtils.getCurrentBlockTime();
      expect(currStreamBalance.toNumber()).to.eq(prevStreamBalance.plus(ubiPerSecond.multipliedBy(lastBlockTime - nextBlockTime)).toNumber(), "Stream should increase the balance in 1 UBI");
    });

    it("happy path - When human stops being registered, stream should stop accruing.", async () => {
      setSubmissionIsRegistered(addresses[0], true);
      setSubmissionIsRegistered(addresses[2], false);

      // Create stream 1 minute after current blockTime
      const currentBlockTime = await testUtils.getCurrentBlockTime();
      const fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
      const toDate = moment(fromDate).add(1, "hour").toDate();

      // Create a stream from address 0 to address 1
      const ubiPerSecond = BigNumber((await ubi.getAccruedPerSecond()).toString());
      lastStreamId = await testUtils.createStream(accounts[0], addresses[1], ubiPerSecond.toNumber(), fromDate, toDate, ubi);

      // Wait 1 hour
      await testUtils.timeForward(testUtils.hoursToSeconds(1), network);

      // Unregister human
      setSubmissionIsRegistered(addresses[0], false);

      // GetStream balance
      const streamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId, addresses[1], ubi)).toString())
      expect(streamBalance.toNumber()).to.eq(0, "Stream should not accrue if human is not registered");

    });

    it("require fail - Creating a stream from a non registerded human should fail", async () => {
      // Unregister human
      setSubmissionIsRegistered(addresses[1], false);

      // Create stream 1 minute after current blockTime
      const currentBlockTime = await testUtils.getCurrentBlockTime();
      const fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
      const toDate = moment(fromDate).add(1, "hour").toDate();
      const ubiPerSecond = BigNumber((await ubi.getAccruedPerSecond()).toString());
      await expect(testUtils.createStream(accounts[1], addresses[2], ubiPerSecond.toNumber(), fromDate, toDate, ubi)).to.be.revertedWith("Only registered humans can stream UBI.");
    })

    it("happy path - Creating a new stream after one has finished should not increment the number of active streams", async () => {
      setSubmissionIsRegistered(addresses[0], true);

      // Get the previous stream count
      const prevStreamsCount = await ubi.getStreamsCount(addresses[0]);

      // Move blocktime top the end of last stream
      await testUtils.goToEndOfStream(lastStreamId, ubi, network);

      // Create a new stream
      const currentBlockTime = await testUtils.getCurrentBlockTime();
      const fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
      const toDate = moment(fromDate).add(1, "hour").toDate();
      const ubiPerSecond = BigNumber((await ubi.getAccruedPerSecond()).toString());
      
      // Create stream with half ubiPerSecond delegation
      lastStreamId = await testUtils.createStream(accounts[0], addresses[1], ubiPerSecond.div(2).toNumber(), fromDate, toDate, ubi);
      const currStreamsCount = await ubi.getStreamsCount(addresses[0]);
      expect(currStreamsCount.toNumber()).to.eq(prevStreamsCount.toNumber(), "Creating a stream after another has finished should not increase stream count");
    });

    it("happy path - Creating a new stream while others are running or pending should increment the number of active streams", async () => {
      setSubmissionIsRegistered(addresses[0], true);

      const prevStreamsCount = await ubi.getStreamsCount(addresses[0]);
      
      // Move blocktime to the begining of the previous stream
      await testUtils.goToStartOfStream(lastStreamId, ubi, network);

      // Create a new stream
      const currentBlockTime = await testUtils.getCurrentBlockTime();
      const fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
      const toDate = moment(fromDate).add(1, "hour").toDate();
      const ubiPerSecond = BigNumber((await ubi.getAccruedPerSecond()).toString());

      // Create another stream with half of ubiperSecond delegation (previous stream is half already)
      lastStreamId = await testUtils.createStream(accounts[0], addresses[2], ubiPerSecond.div(2).toNumber(), fromDate, toDate, ubi);
      const currStreamsCount = await ubi.getStreamsCount(addresses[0]);
      expect(currStreamsCount.toNumber()).to.eq(prevStreamsCount.toNumber() + 1, "Creating a stream after another has finished should not increase stream count");
    });

    it("happy path - Creating 2 streams with half accruedPerSecond per each should accrue the same value.", async () => {
      setSubmissionIsRegistered(addresses[0], true);
      // Get the last created stream
      const stream = await ubi.getStream(lastStreamId);
      // Move to the end of the stream
      await testUtils.setNextBlockTime(stream.stopTime.toNumber(), network);
      expect(await testUtils.getCurrentBlockTime()).to.eq(stream.stopTime.toNumber(), "Current block time should be the end of the last stream");

      // Create a new stream
      const currentBlockTime = await testUtils.getCurrentBlockTime();
      const fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
      const toDate = moment(fromDate).add(1, "hour").toDate();
      const ubiPerSecond = BigNumber((await ubi.getAccruedPerSecond()).toString());

      // Create 2 streams with accruedPerSecond / 2
      const firstStreamId = await testUtils.createStream(accounts[0], addresses[1], ubiPerSecond.div(2).toNumber(), fromDate, toDate, ubi);
      const secondStreamId = await testUtils.createStream(accounts[0], addresses[2], ubiPerSecond.div(2).toNumber(), fromDate, toDate, ubi);
      lastStreamId = secondStreamId;
      expect((await ubi.getStreamsCount(addresses[0])).toNumber()).to.eq(2, "There should only be 2 streams");

      // Move blocktime to end of firts stream (2nd is the same)
      const firstStream = await ubi.getStream(firstStreamId);
      await testUtils.setNextBlockTime(firstStream.stopTime.toNumber(), network);

      // Accrued balance should be half UBI for both streamn
      const firstStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(firstStreamId, addresses[1], ubi)).toString());
      const secondStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(secondStreamId, addresses[2], ubi)).toString());
      expect(firstStreamBalance.toNumber()).to.eq(ubiPerSecond.div(2).multipliedBy(3600).toNumber(), "Invalid balance of first stream");
      expect(secondStreamBalance.toNumber()).to.eq(ubiPerSecond.div(2).multipliedBy(3600).toNumber(), "Invalid balance of second stream");
    })

    it("happy path - Creating 1 streams with half accruedPerSecond should accrue half for the stream and half for the human.", async () => {
      setSubmissionIsRegistered(addresses[0], true);
      // Get the last created stream
      const lastStream = await ubi.getStream(lastStreamId);
      // Move to the end of the stream
      if (await testUtils.getCurrentBlockTime() < lastStream.stopTime.toNumber()) {
        await testUtils.setNextBlockTime(lastStream.stopTime.toNumber(), network);
        expect(await testUtils.getCurrentBlockTime()).to.eq(lastStream.stopTime.toNumber(), "Current block time should be the end of the last stream");
      }

      // Create a new stream with half ubiPerSecond
      const currentBlockTime = await testUtils.getCurrentBlockTime();
      const fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
      const toDate = moment(fromDate).add(1, "hour").toDate();
      const ubiPerSecond = BigNumber((await ubi.getAccruedPerSecond()).toString()).div(2);
      // Create 1 streams with half of accrued per second.
      lastStreamId = await testUtils.createStream(accounts[0], addresses[1], ubiPerSecond.toNumber(), fromDate, toDate, ubi);

      // Move blocktime to start of stream
      const stream = await ubi.getStream(lastStreamId);
      await testUtils.setNextBlockTime(stream.startTime.toNumber(), network);

      // get initial balance of stream and human
      const prevhumanBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[0], ubi)).toString());
      const prevStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId, addresses[1], ubi)).toString())

      // Move blocktime to end of stream
      await testUtils.goToEndOfStream(lastStreamId, ubi, network);

      // get last balance of stream and human
      const newHumanBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[0], ubi)).toString());
      const lastStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId, addresses[1], ubi)).toString())

      // Accrued balance should be half UBI for both streamn
      expect(newHumanBalance.toNumber()).to.eq(prevhumanBalance.plus(ubiPerSecond.multipliedBy(3600)).toNumber(), "Human should accrue only half of UBI");
      expect(lastStreamBalance.toNumber()).to.eq(prevStreamBalance.plus(ubiPerSecond.multipliedBy(3600)).toNumber(), "Stream should accrue only half of UBI");
    })

    it("require fail - Creating 2 overlaping streams that, when overlaped, sum more than the allowed ubiPerSecond should fail", async () => {
      setSubmissionIsRegistered(addresses[0], true);

      // initial variables
      const currentBlockTime = await testUtils.getCurrentBlockTime();
      const ubiPerSecond = BigNumber((await ubi.getAccruedPerSecond()).toString());
      
      // Create a stream with total accrued per second
      const fromDate1 = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
      const toDate1 = moment(fromDate1).add(1, "hour").toDate();
      lastStreamId = await testUtils.createStream(accounts[0], addresses[1], ubiPerSecond.toNumber(), fromDate1, toDate1, ubi);

      // Create a second stream with total accrued per second but that starts after previous stream starts and beofre it finished
      const fromDate2 = moment(fromDate1).add(30, "minutes").toDate();
      const toDate2 = moment(fromDate2).add(1, "hour").toDate();
      await expect(testUtils.createStream(accounts[0], addresses[2], ubiPerSecond.toNumber(), fromDate2, toDate2, ubi))
        .to.be.revertedWith("Delegated value exceeds available balance for the given stream period");
    })

    //// WITHDRAWAL TEST
    describe("UBI stream withdrawals", () => {
      it("happy path - After stream is finished, and recipient withdraws the balance, stream balance should be 0 and recipient balance should be the stream total", async () => {
        
        // Move blocktime to the end of the last stream
        await testUtils.goToEndOfStream(lastStreamId, ubi, network);

        // Create a new stream with half ubiPerSecond
        const currentBlockTime = await testUtils.getCurrentBlockTime();
        const fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
        const toDate = moment(fromDate).add(1, "hour").toDate();
        const ubiPerSecond = BigNumber((await ubi.getAccruedPerSecond()).toString()).div(2);

        // Create 1 stream with accruedPerSecond.
        lastStreamId = await testUtils.createStream(accounts[0], addresses[1], ubiPerSecond.toNumber(), fromDate, toDate, ubi);

        // Get the stream
        const stream = await ubi.getStream(lastStreamId);

        // Move blocktime to end of stream
        await testUtils.setNextBlockTime(stream.stopTime.toNumber() + 1, network);

        // Get balances
        const prevRecipientBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[1], ubi)).toString());
        const prevStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId, addresses[1], ubi)).toString());

        // Recipient withdraws balance 
        await ubi.connect(accounts[1]).withdrawFromStream(lastStreamId, prevStreamBalance.toString());

        // New balance of stream should be 0
        const newStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId, addresses[1], ubi)).toString());
        expect(newStreamBalance.toNumber()).to.eq(0, "Stream balance should be 0 after withdrawal");

        // New balance of recipient should be previous + streamBalance
        const newRecipientBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[1], ubi)).toString());
        expect(newRecipientBalance.toNumber()).to.eq(prevRecipientBalance.plus(prevStreamBalance).toNumber(), "Recipient balance should increase by the balance of the stream.");

      })

      it("happy path - After withdrawing from an active stream, balance should be 0 right after, but keep accruing until the end.", async () => {
        setSubmissionIsRegistered(addresses[0], true);

        // Go to the end of the last created stream to clear the path for new test
        await testUtils.goToEndOfStream(lastStreamId, ubi, network);

        // Get accrued per second
        const ubiPerSecond = BigNumber((await ubi.getAccruedPerSecond()).toString());

        // New stream will start in 1 minute and last for 1 hour
        const currentBlockTime = await testUtils.getCurrentBlockTime();
        const fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
        const toDate = moment(fromDate).add(1, "hour").toDate();

        // Create stream
        lastStreamId = await testUtils.createStream(accounts[0], addresses[1], ubiPerSecond.toNumber(), fromDate, toDate, ubi);

        // Go to start
        await testUtils.goToStartOfStream(lastStreamId, ubi, network);

        // Get balances
        const prevRecipientBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[1], ubi)).toString());
        const initialStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId, addresses[1], ubi)).toString());
        expect(initialStreamBalance.toNumber()).to.eq(0, "Initial stream balance should be 0");

        // Move fwd 30 mins
        await testUtils.timeForward(30 * 60, network);

        // The new stream balance should be half a UBI (ubiPerSecond * 30 * 60).
        const currentStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId, addresses[1], ubi)).toString());
        expect(currentStreamBalance.toNumber()).to.eq(initialStreamBalance.plus(ubiPerSecond.multipliedBy(30 * 60)).toNumber(), "Stream accrued balance should be half a UBI.");

        // Withdraw the current stream balance *️⃣(this mines a block and moves blocktime by 1 second)
        await ubi.connect(accounts[0]).withdrawFromStream(lastStreamId, currentStreamBalance.toString());

        // New recipient balance should be the same as previous + current stream balance + 1 (because of *️⃣)
        const newRecipientBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[1], ubi)).toString());
        expect(newRecipientBalance.toNumber()).to.eq(prevRecipientBalance.plus(currentStreamBalance).toNumber(), "After withdrawal, recipient balance should increase by the amount of withdrawn balance");

        // // Move to the end of the stream and check stream balance.
        await testUtils.goToEndOfStream(lastStreamId, ubi, network);
        await testUtils.timeForward(10, network);

        // Final balance sholud be 29 minutes of accruance (because of *️⃣)
        const finalStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId, addresses[1], ubi)).toString());
        expect(finalStreamBalance.toNumber()).to.eq(ubiPerSecond.multipliedBy((30 * 60)).toNumber(), "After stream finishes, the balance should account for the withdrawn balance.");

      })

      it("require fail - Withdraw more than the stream balance while its active should fail", async () => {

        // Go to the end of the last created stream to clear the path for new test
        await testUtils.goToEndOfStream(lastStreamId, ubi, network);

        // Get accrued per second
        const ubiPerSecond = BigNumber((await ubi.getAccruedPerSecond()).toString());

        // New stream will start in 1 minute and last for 1 hour
        const currentBlockTime = await testUtils.getCurrentBlockTime();
        const fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
        const toDate = moment(fromDate).add(1, "hour").toDate();

        // Create stream
        lastStreamId = await testUtils.createStream(accounts[0], addresses[1], ubiPerSecond.toNumber(), fromDate, toDate, ubi);

        // Go to start
        await testUtils.goToStartOfStream(lastStreamId, ubi, network);

        // Get balances
        const initialStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId, addresses[1], ubi)).toString());
        expect(initialStreamBalance.toNumber()).to.eq(0, "Initial stream balance should be 0");

        // Move fwd 30 mins
        await testUtils.timeForward(30 * 60, network);

        // The new stream balance should be half a UBI (ubiPerSecond * 30 * 60).
        const currentStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId, addresses[1], ubi)).toString());
        expect(currentStreamBalance.toNumber()).to.eq(initialStreamBalance.plus(ubiPerSecond.multipliedBy(30 * 60)).toNumber(), "Stream accrued balance should be half a UBI.");

        // Withdraw the current stream balance + 2. (1 second for the mined block and 1 to pass the max balance)
        await expect(ubi.connect(accounts[0]).withdrawFromStream(lastStreamId, currentStreamBalance.plus(ubiPerSecond * 2).toString()))
          .to.be.revertedWith("amount exceeds the available balance");
      })

      it("require fail - Withdraw more than the stream balance after stream finished should fail", async () => {

        // Go to end of previous stream
        await testUtils.goToEndOfStream(lastStreamId, ubi, network);

        // Get balances
        let streamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId, addresses[1], ubi)).toString());
        expect(streamBalance.toNumber()).to.eq(ubiPerSecond.multipliedBy((60 * 60)).toNumber(), "Stream balance should be 30 minutes");

        // Try to withdrawy the total balance +1
        await expect(ubi.connect(accounts[0]).withdrawFromStream(lastStreamId, streamBalance.plus(ubiPerSecond).toString()))
          .to.be.revertedWith("amount exceeds the available balance");
      })

      it("happy path - Withdraw in the middle of stream and after it finished should add the total delegated balance", async () => {

        // Create a new stream with half ubiPerSecond
        const currentBlockTime = await testUtils.getCurrentBlockTime();
        const fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
        const toDate = moment(fromDate).add(1, "hour").toDate();
        const ubiPerSecond = BigNumber((await ubi.getAccruedPerSecond()).toString()).div(2);

        // Create 1 stream with accruedPerSecond.
        lastStreamId = await testUtils.createStream(accounts[0], addresses[1], ubiPerSecond.toNumber(), fromDate, toDate, ubi);

        // Get the stream
        const stream = await ubi.getStream(lastStreamId);

        // Move blocktime to the middle of the stream
        const streamStart = BigNumber(stream.startTime.toString());
        const streamStop = BigNumber(stream.stopTime.toString());
        await testUtils.setNextBlockTime(streamStart.plus(streamStop.minus(streamStart).div(2)).toNumber(), network);

        // Get balances
        const prevRecipientBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[1], ubi)).toString());
        const prevStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId, addresses[1], ubi)).toString());

        // Recipient withdraws balance 
        await ubi.connect(accounts[1]).withdrawFromStream(lastStreamId, prevStreamBalance.toString());

        // New balance of stream should be ubiPerSecond * 1 second (withdraw mines and moves blocktime 1 second).
        const newStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId, addresses[1], ubi)).toString());
        expect(newStreamBalance.toNumber()).to.eq(ubiPerSecond.toNumber(), "Stream balance should be of 1 second * ubiPerSecond after withdrawal");

        // New balance of recipient should be previous + streamBalance
        const newRecipientBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[1], ubi)).toString());
        expect(newRecipientBalance.toNumber()).to.eq(prevRecipientBalance.plus(prevStreamBalance).toNumber(), "Recipient balance should increase by the withdrawn balance of the stream.");

        // Move to the end of the stream
        await testUtils.goToEndOfStream(lastStreamId, ubi, network);

        // Stream lasted 1 hour and withdraw was at 30 minutes of stream. Remaining balance should account for the remaining 30 minutes
        const remainingStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId, addresses[1], ubi)).toString());
        expect(remainingStreamBalance.toNumber()).to.eq(ubiPerSecond.multipliedBy(30*60).toNumber(), "Stream balance should be ubiPerSecond * 30 minutes");

        // Withdraw remaining balance.
        await ubi.connect(accounts[1]).withdrawFromStream(lastStreamId, remainingStreamBalance.toString());
        
        // Last balance of recipient should be the total of the stream (1 hour of ubiPerSecond)
        const finalRecipientBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[1], ubi)).toString());
        expect(finalRecipientBalance.toNumber()).to.eq(prevRecipientBalance.plus(ubiPerSecond.multipliedBy(60*60)).toNumber(), "Recipient balance should increase by the balance of the stream.");
      })
    });
  })
});
