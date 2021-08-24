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
        expect((await testUtils.ubiBalanceOfHuman(addresses[1], ubi)).toString()).to.equal('0');
      });

      it("happy path - a submission with interrupted accruing still keeps withdrawn coins.", async () => {
        await ubi.transfer(addresses[1], 555);
        await setSubmissionIsRegistered(addresses[1], true);
        await network.provider.send("evm_increaseTime", [7200]);
        await network.provider.send("evm_mine");
        await setSubmissionIsRegistered(addresses[1], false);
        await network.provider.send("evm_increaseTime", [7200]);
        await network.provider.send("evm_mine");
        expect((await testUtils.ubiBalanceOfHuman(addresses[1], ubi)).toString()).to.equal('555');
      });

      it("happy path - a submission that natively accrued keeps transfered coins upon interruption.", async () => {
        await setSubmissionIsRegistered(accounts[3].address, true);
        expect((await testUtils.ubiBalanceOfHuman(addresses[3], ubi)).toString()).to.equal('0');
        await ubi.startAccruing(accounts[3].address);
        await network.provider.send("evm_increaseTime", [7200]);
        await network.provider.send("evm_mine");
        await ubi.connect(accounts[3]).transfer(addresses[1], 55);
        expect((await testUtils.ubiBalanceOfHuman(addresses[1], ubi)).toString()).to.equal('610');
      });

      it("happy path - check that Mint and Transfer events get called when it corresponds.", async () => {
        const owner = accounts[9];
        const initialBalance = await testUtils.ubiBalanceOfHuman(owner.address, ubi);
        await setSubmissionIsRegistered(owner.address, true);
        await ubi.startAccruing(owner.address);
        await network.provider.send("evm_increaseTime", [1]);
        await network.provider.send("evm_mine");
        expect(await testUtils.ubiBalanceOfHuman(owner.address, ubi)).to.be.above(initialBalance);
        await expect(ubi.connect(owner).transfer(addresses[8], 18000))
          .to.emit(ubi, "Transfer")
        await expect(ubi.connect(owner).burn('199999999966000'))
          .to.emit(ubi, "Transfer")
        await setSubmissionIsRegistered(owner.address, false);
        await expect(ubi.connect(owner).burn('100000000000000'))
          .to.emit(ubi, "Transfer")
        expect(await testUtils.ubiBalanceOfHuman(owner.address, ubi)).to.be.at.least(3000);
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
        const previousBalance = new BigNumber((await testUtils.ubiBalanceOfHuman(addresses[0], ubi)).toString());
        await ubi.burnAndPost(ethers.utils.parseEther("0.01"), altPoster, 'hello world');
        const newBalance = new BigNumber((await testUtils.ubiBalanceOfHuman(addresses[0], ubi)).toString());
        expect(newBalance.toNumber()).to.lessThan(previousBalance.toNumber());
      });
    });
  });

  describe("UBI accruing delegation", () => {

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
      const prevHumanBalance = BigNumber((await testUtils.ubiBalanceOfHuman(addresses[0], ubi)).toString());

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
      const currHumanBalance = BigNumber((await testUtils.ubiBalanceOfHuman(addresses[0], ubi)).toString());
      expect(currHumanBalance.toNumber()).to.eq(prevHumanBalance.plus(ubiPerSecond.multipliedBy(newBlockTime - blockTimeAfterStreamCreation)).toNumber(), "Human balance ");

      const currentStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId.toString(), addresses[1], ubi)).toString())
      expect(currentStreamBalance.toNumber()).to.eq(0, "Current stream balance should still be 0");

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
      const prevHumanBalance = BigNumber((await testUtils.ubiBalanceOfHuman(addresses[0], ubi)).toString());
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
      const currHumanBalance = BigNumber((await testUtils.ubiBalanceOfHuman(addresses[0], ubi)).toString());
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
      // Get the last created stream
      const stream = await ubi.getStream(lastStreamId);

      const prevStreamsCount = await ubi.getStreamsCount(addresses[0]);

      // Move blocktime to be after stream stopTime
      if (await testUtils.getCurrentBlockTime() < stream.stopTime.toNumber()) {
        await testUtils.setNextBlockTime(stream.stopTime.toNumber() + 1, network);
        expect(await testUtils.getCurrentBlockTime()).to.be.greaterThan(stream.stopTime.toNumber(), "Current blocktime should be after last stream stop time");
      }

      // Create a new stream
      const currentBlockTime = await testUtils.getCurrentBlockTime();
      const fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
      const toDate = moment(fromDate).add(1, "hour").toDate();
      const ubiPerSecond = BigNumber((await ubi.getAccruedPerSecond()).toString());
      lastStreamId = await testUtils.createStream(accounts[0], addresses[1], ubiPerSecond.toNumber(), fromDate, toDate, ubi);
      const currStreamsCount = await ubi.getStreamsCount(addresses[0]);
      expect(currStreamsCount.toNumber()).to.eq(prevStreamsCount.toNumber(), "Creating a stream after another has finished should not increase stream count");
    });

    it("happy path - Creating a new stream while others are running or pending should increment the number of active streams", async () => {
      setSubmissionIsRegistered(addresses[0], true);
      // Get the last created stream
      const stream = await ubi.getStream(lastStreamId);

      const prevStreamsCount = await ubi.getStreamsCount(addresses[0]);

      // Move blocktime to be after stream startTime
      if (await testUtils.getCurrentBlockTime() < stream.startTime.toNumber()) {
        await testUtils.setNextBlockTime(stream.startTime.toNumber(), network);
        expect(await testUtils.getCurrentBlockTime()).to.be.eq(stream.startTime.toNumber(), "Current blocktime should be last stream start time");
      }

      // Create a new stream
      const currentBlockTime = await testUtils.getCurrentBlockTime();
      const fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
      const toDate = moment(fromDate).add(1, "hour").toDate();
      const ubiPerSecond = BigNumber((await ubi.getAccruedPerSecond()).toString());
      lastStreamId = await testUtils.createStream(accounts[0], addresses[2], ubiPerSecond.toNumber(), fromDate, toDate, ubi);
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

    it("happy path - Creating 1 stream with half accruedPerSecond per each should accrue half for the steram and half for the human.", async () => {
      setSubmissionIsRegistered(addresses[0], true);
      // Get the last created stream
      const lastStream = await ubi.getStream(lastStreamId);
      // Move to the end of the stream
      if(await testUtils.getCurrentBlockTime() < lastStream.stopTime.toNumber()) {
        await testUtils.setNextBlockTime(lastStream.stopTime.toNumber(), network);
        expect(await testUtils.getCurrentBlockTime()).to.eq(lastStream.stopTime.toNumber(), "Current block time should be the end of the last stream");
      }

      // Create a new stream with half ubiPerSecond
      const currentBlockTime = await testUtils.getCurrentBlockTime();
      const fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
      const toDate = moment(fromDate).add(1, "hour").toDate();
      const ubiPerSecond = BigNumber((await ubi.getAccruedPerSecond()).toString()).div(2);
      console.log("UBI PER SECOND", ubiPerSecond.toNumber());
      // Create 2 streams with accruedPerSecond / 2
      lastStreamId = await testUtils.createStream(accounts[0], addresses[1], ubiPerSecond.toNumber(), fromDate, toDate, ubi);

      // Move blocktime to start of stream
      const stream = await ubi.getStream(lastStreamId);
      await testUtils.setNextBlockTime(stream.startTime.toNumber(), network);

      // get initial balance of stream and human
      const prevhumanBalance = BigNumber((await testUtils.ubiBalanceOfHuman(addresses[0], ubi)).toString());
      const prevStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId, addresses[1], ubi)).toString())

      // Move blocktime to end of stream
      await testUtils.setNextBlockTime(stream.stopTime.toNumber(), network);

      // get last balance of stream and human
      const newHumanBalance = BigNumber((await testUtils.ubiBalanceOfHuman(addresses[0], ubi)).toString());
      const lastStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId, addresses[1], ubi)).toString())

      // Accrued balance should be half UBI for both streamn
      expect(newHumanBalance.toNumber()).to.eq(prevhumanBalance.plus(ubiPerSecond.multipliedBy(3600)).toNumber(), "Human should accrue only half of UBI");
      expect(lastStreamBalance.toNumber()).to.eq(prevStreamBalance.plus(ubiPerSecond.multipliedBy(3600)).toNumber(), "Stream should accrue only half of UBI");
    })
  })
});
