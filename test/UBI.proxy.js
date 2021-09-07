const { default: BigNumber } = require("bignumber.js");
const { expect } = require("chai");
const deploymentParams = require('../deployment-params');
const testUtils = require("./testUtils");
const moment = require("moment");
const { network, upgrades } = require("hardhat");

const ONE_HOUR = 3600;
const TWO_HOURS = 3600 * 2;

let accounts;



/**
 @summary Tests for UBI.sol
*/
contract('UBI_v2.sol', accounts => {
    before(async () => {
        accounts = await ethers.getSigners();

        [_addresses, mockProofOfHumanity] = await Promise.all([
            Promise.all(accounts.map((account) => account.getAddress())),
            waffle.deployMockContract(
                accounts[0],
                require("../artifacts/contracts/UBI_v2.sol/IProofOfHumanity.json").abi
            )
        ]);
        setSubmissionIsRegistered = (submissionID, isRegistered) =>
            mockProofOfHumanity.mock.isRegistered
                .withArgs(submissionID)
                .returns(isRegistered);

        setSubmissionInfo = (submissionID, info) => {
            mockProofOfHumanity.mock.getSubmissionInfo
                .withArgs(submissionID)
                .returns({
                    submissionTime: info.submissionTime
                });
        }

        addresses = _addresses;

        UBI_V1 = await ethers.getContractFactory("UBI");

        ubi = await upgrades.deployProxy(UBI_V1,
            [deploymentParams.INITIAL_SUPPLY, deploymentParams.TOKEN_NAME, deploymentParams.TOKEN_SYMBOL, deploymentParams.ACCRUED_PER_SECOND, mockProofOfHumanity.address],
            { initializer: 'initialize', unsafeAllowCustomTypes: true }
        );

        UBICoin = await ethers.getContractFactory("UBI_v2");
        ubi = await upgrades.upgradeProxy(ubi.address, UBICoin);
        await ubi.deployed();

        // Initialize values on upgraded contract.
        await ubi.upgrade();
        
        // For testing purposes only, we define a max of 10 streams allowed
        await ubi.setMaxStreamsAllowed(10);

        altProofOfHumanity = await waffle.deployMockContract(accounts[0], require("../artifacts/contracts/UBI_v2.sol/IProofOfHumanity.json").abi);

        // Global contract variables
        accruedPerSecond = BigNumber((await ubi.accruedPerSecond()).toString());
        maxStreamsAllowed = BigNumber((await ubi.maxStreamsAllowed()).toString());
        console.log("Max streams allowed", maxStreamsAllowed.toNumber());

        // Set zero address as not registered
        setSubmissionIsRegistered(ethers.constants.AddressZero, false);
    });

    const ubiCoinTests = () => {

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

        it("happy path - a submission removed from Proof of Humanity no longer accrues value,  but keeps its consolidated balance.", async () => {
            // get the consolidated balance of the wallet
            const prevConsolidatedBalance = await testUtils.ubiConsolidatedBalanceOfWallet(addresses[1], ubi);
            await network.provider.send("evm_increaseTime", [7200]);
            await network.provider.send("evm_mine");
            await setSubmissionIsRegistered(addresses[1], false);
            await network.provider.send("evm_increaseTime", [3600]);
            await network.provider.send("evm_mine");
            expect((await testUtils.ubiBalanceOfWallet(addresses[1], ubi)).toNumber()).to.equal(prevConsolidatedBalance.toNumber());
        });

        it("happy path - a submission with interrupted accruing still keeps consolidated balance.", async () => {
            await ubi.transfer(addresses[1], 555);
            // get the consolidated balance of the wallet
            const prevConsolidatedBalance = await testUtils.ubiConsolidatedBalanceOfWallet(addresses[1], ubi);
            await setSubmissionIsRegistered(addresses[1], true);
            await network.provider.send("evm_increaseTime", [7200]);
            await network.provider.send("evm_mine");
            await setSubmissionIsRegistered(addresses[1], false);
            await network.provider.send("evm_increaseTime", [7200]);
            await network.provider.send("evm_mine");
            const newConsolidatedBalance = await testUtils.ubiConsolidatedBalanceOfWallet(addresses[1], ubi)
            expect(newConsolidatedBalance.toNumber()).to.equal(prevConsolidatedBalance.toNumber());
        });

        it("happy path - a submission that natively accrued keeps transfered coins upon interruption.", async () => {
            // No longer valid since the account could have received UBI before registering.
            if ((await ubi.accruedSince(accounts[3].address)).toNumber() === 0) {
                await setSubmissionIsRegistered(accounts[3].address, true);
                expect((await testUtils.ubiBalanceOfWallet(addresses[3], ubi)).toString()).to.equal('0');
                await ubi.startAccruing(accounts[3].address);
            }

            // get the consolidated balance of the wallet
            const initialBalance = await testUtils.ubiBalanceOfWallet(addresses[1], ubi);

            await network.provider.send("evm_increaseTime", [7200]);
            await network.provider.send("evm_mine");
            await ubi.connect(accounts[3]).transfer(addresses[1], 55);

            expect((await testUtils.ubiBalanceOfWallet(addresses[1], ubi)).toNumber()).to.equal(initialBalance.plus(55).toNumber());
        });

        it("happy path - check that Mint and Transfer events get called when it corresponds.", async () => {
            const owner = accounts[9];
            await setSubmissionIsRegistered(owner.address, true);

            const initialBalance = await testUtils.ubiBalanceOfWallet(owner.address, ubi);

            if ((await ubi.accruedSince(owner.address)).toNumber() === 0) {
                expect((await testUtils.ubiBalanceOfWallet(owner.address, ubi)).toString()).to.equal('0');
                await ubi.startAccruing(owner.address);
            }

            await testUtils.timeForward(1, network);

            expect((await testUtils.ubiBalanceOfWallet(owner.address, ubi)).toNumber()).to.be.above(initialBalance.toNumber());
            await expect(ubi.connect(owner).transfer(addresses[8], 18000))
                .to.emit(ubi, "Transfer")
            await expect(ubi.connect(owner).burn('199999999966000'))
                .to.emit(ubi, "Transfer")
            await setSubmissionIsRegistered(owner.address, false);
            await expect(ubi.connect(owner).burn('100000000000000'))
                .to.emit(ubi, "Transfer")
            expect((await testUtils.ubiBalanceOfWallet(owner.address, ubi)).toNumber()).to.be.at.least(3000);
        });

        it("require fail - The submission is still registered in Proof Of Humanity.", async () => {
            // Make sure it reverts if the submission is still registered.
            await setSubmissionIsRegistered(addresses[6], true);
            if ((await ubi.accruedSince(addresses[6])).toNumber() === 0) {
                expect((await testUtils.ubiBalanceOfWallet(addresses[6], ubi)).toString()).to.equal('0');
                await ubi.startAccruing(addresses[6]);
            }

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
    };

    const ubiStreamTests = () => {

        let lastStreamId;
        before(async () => {
            // Restore original PoH
            await ubi.changeProofOfHumanity(mockProofOfHumanity.address);
            expect(await ubi.proofOfHumanity()).to.eq(mockProofOfHumanity.address);

            setSubmissionIsRegistered(addresses[0], true);
            expect(await mockProofOfHumanity.isRegistered(addresses[0])).to.eq(true);
            setSubmissionIsRegistered(addresses[1], false);
            expect(await mockProofOfHumanity.isRegistered(addresses[1])).to.eq(false);

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
            const accruedPerSecond = BigNumber((await ubi.accruedPerSecond()).toString());

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
            const toDate = moment(fromDate).add(1, "hour").toDate();

            // try to create stream with a value lower should revert
            lastStreamId = await testUtils.createStream(accounts[0], addresses[1], accruedPerSecond.toNumber(), fromDate, toDate, ubi);
            const blockTimeAfterStreamCreation = await testUtils.getCurrentBlockTime();

            // Get previous human balance 
            const prevHumanBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[0], ubi)).toString());

            // Get previous Stream balance
            const prevStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId.toString(), addresses[1], ubi)).toString())
            expect(prevStreamBalance.toNumber()).to.eq(0, "Initial stream balance should be 0");

            // Move blocktime to the start of the stream
            await testUtils.goToStartOfStream(lastStreamId, ubi, network);

            const streamStartBlockTime = await testUtils.getCurrentBlockTime();

            // Get current human balance 
            const currHumanBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[0], ubi)).toString());
            expect(currHumanBalance.toNumber()).to.eq(prevHumanBalance.plus(accruedPerSecond.multipliedBy(streamStartBlockTime - blockTimeAfterStreamCreation)).toNumber(), "Human balance ");

            const currentStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId.toString(), addresses[1], ubi)).toString())
            expect(currentStreamBalance.toNumber()).to.eq(0, "Current stream balance should still be 0");

        });

        it("require fail - Creating a stream from a non registered account should fail.", async () => {
            setSubmissionIsRegistered(addresses[1], false);
            // Stream from NOW until the next 1 hour
            const currentBlockTime = await testUtils.getCurrentBlockTime();

            const fromDate = moment(new Date(currentBlockTime * 1000)).add(10, "minutes").toDate();
            const toDate = moment(fromDate).add(1, "hour").toDate();

            // try to create stream with a non registered account
            await expect(testUtils.createStream(accounts[1], addresses[2], accruedPerSecond.toNumber(), fromDate, toDate, ubi))
                .to.be.revertedWith("Only registered humans can stream UBI.");
        });

        it("require fail - Creating stream to an existing valid stream recipient should fail.", async () => {
            setSubmissionIsRegistered(addresses[0], true);
            setSubmissionIsRegistered(addresses[1], false);

            // Stream from NOW until the next 1 hour
            const currentBlockTime = await testUtils.getCurrentBlockTime();

            const fromDate = moment(new Date(currentBlockTime * 1000)).add(10, "minutes").toDate();
            const toDate = moment(fromDate).add(1, "hour").toDate();

            // try to create stream with a value lower should revert
            await expect(testUtils.createStream(accounts[0], addresses[1], accruedPerSecond.toNumber(), fromDate, toDate, ubi))
                .to.be.revertedWith("Account is already a recipient on an active or overlaping stream.");
        });

        it("happy path - While stream with full accruedPerSecond delegation is active, human should not accrue any UBI and stream should accrue.", async () => {
            setSubmissionIsRegistered(accounts[0].address, true);
            setSubmissionIsRegistered(addresses[1], false);

            // Move last stream to the end
            await testUtils.goToEndOfStream(lastStreamId, ubi, network);

            // NEW STREAM
            const initialBlockTime = await testUtils.getCurrentBlockTime();
            // Stream starts at current blocktime + 1 hour
            const fromDate = moment(new Date(initialBlockTime * 1000)).add(1, "hours").toDate();
            // Stream lasts 2 hours
            const toDate = moment(fromDate).add(1, "hour").toDate();

            // Create a new stream delegating all ubiPerSecond
            lastStreamId = await testUtils.createStream(accounts[0], addresses[1], accruedPerSecond.toNumber(), fromDate, toDate, ubi);
            const stream = await ubi.getStream(lastStreamId);

            // Move blocktime to the start of the stream
            await testUtils.goToStartOfStream(lastStreamId, ubi, network);

            // Get previous human balance 
            const prevHumanBalance = await testUtils.ubiBalanceOfWallet(addresses[0], ubi);
            // Get previous Stream balance
            const prevStreamBalance = await testUtils.ubiBalanceOfStream(lastStreamId, addresses[1], ubi);

            // Move block time to the end of the stream
            await testUtils.goToEndOfStream(lastStreamId, ubi, network);

            const streamTotalTime = stream.stopTime.toNumber() - stream.startTime.toNumber();

            // Get current human balance 
            const currHumanBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[0], ubi)).toString());
            // Get current Stream balance
            const currStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId, addresses[1], ubi)).toString())

            // Human should have not accrued the balance of 1 hour
            expect(currHumanBalance.toNumber()).to.eq(prevHumanBalance.toNumber(), "Human should not increase balance after delegating all UBIs per second");
            // Stream should have accrued the balance of 1 hour
            expect(currStreamBalance.toNumber()).to.eq(prevStreamBalance.plus(BigNumber(stream.ratePerSecond.toNumber()).multipliedBy(streamTotalTime)).toNumber(), "Stream should increase the balance in 1 UBI");
        });

        it("happy path - When human stops being registered, stream should stop accruing.", async () => {
            setSubmissionIsRegistered(addresses[0], true);
            setSubmissionIsRegistered(addresses[2], false);

            // Create stream 1 minute after current blockTime
            const currentBlockTime = await testUtils.getCurrentBlockTime();
            const fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
            const toDate = moment(fromDate).add(1, "hour").toDate();

            // Create a stream from address 0 to address 1
            lastStreamId = await testUtils.createStream(accounts[0], addresses[1], accruedPerSecond.toNumber(), fromDate, toDate, ubi);

            // Move to end of stream
            await testUtils.goToEndOfStream(lastStreamId, ubi, network);

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

            await expect(testUtils.createStream(accounts[1], addresses[2], accruedPerSecond.toNumber(), fromDate, toDate, ubi)).to.be.revertedWith("Only registered humans can stream UBI.");
        })

        it("happy path - Creating a new stream after one has finished and has been withdrawn should not increment the number of active streams", async () => {
            setSubmissionIsRegistered(addresses[0], true);

            // Get the previous stream count
            const prevStreamsCount = await ubi.getStreamsCount(addresses[0]);

            // Move blocktime top the end of last stream
            await testUtils.goToEndOfStream(lastStreamId, ubi, network);

            // Withdraw the balance from the stream
            const streamBalance = await testUtils.ubiBalanceOfStream(lastStreamId, addresses[1], ubi);
            await ubi.connect(accounts[1]).withdrawFromStream(lastStreamId, streamBalance.toString());

            // Create a new stream
            const currentBlockTime = await testUtils.getCurrentBlockTime();
            const fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
            const toDate = moment(fromDate).add(1, "hour").toDate();

            // Delegate half of UBI per second
            const delegatedPerSecond = accruedPerSecond.div(2).toNumber();

            // Create stream with half ubiPerSecond delegation
            lastStreamId = await testUtils.createStream(accounts[0], addresses[1], delegatedPerSecond, fromDate, toDate, ubi);
            const currStreamsCount = await ubi.getStreamsCount(addresses[0]);
            expect(currStreamsCount.toNumber()).to.eq(prevStreamsCount.toNumber(), "Creating a stream after another has finished and been withdrawn should not increase stream count");
        });

        it("happy path - Creating a new stream after one has finished and has not been withdrawn should increment the number of active streams", async () => {
            setSubmissionIsRegistered(addresses[0], true);

            // Get the previous stream count
            const prevStreamsCount = BigNumber((await ubi.getStreamsCount(addresses[0])).toString());

            // Move blocktime top the end of last stream
            await testUtils.goToEndOfStream(lastStreamId, ubi, network);

            // Create a new stream
            const currentBlockTime = await testUtils.getCurrentBlockTime();
            const fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
            const toDate = moment(fromDate).add(1, "hour").toDate();

            // Delegate half of UBI per second
            const delegatedPerSecond = accruedPerSecond.div(2).toNumber();

            // Create stream with half ubiPerSecond delegation
            lastStreamId = await testUtils.createStream(accounts[0], addresses[1], delegatedPerSecond, fromDate, toDate, ubi);
            const currStreamsCount = await ubi.getStreamsCount(addresses[0]);
            expect(currStreamsCount.toNumber()).to.eq(prevStreamsCount.plus(1).toNumber(), "Creating a stream after another has finished but not withdrawn should increase stream count");
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

            // Delegate half of UBI per second
            const delegatedPerSecond = accruedPerSecond.div(2).toNumber();

            // Create another stream with half of ubiperSecond delegation (previous stream is half already)
            lastStreamId = await testUtils.createStream(accounts[0], addresses[2], delegatedPerSecond, fromDate, toDate, ubi);
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

            // Delegate half of UBI per second
            const delegatedPerSecond = accruedPerSecond.div(2);

            // Get stream counts
            const initialStreamCount = BigNumber((await ubi.getStreamsCount(addresses[0])).toString());

            // Create 2 streams with accruedPerSecond / 2
            const firstStreamId = await testUtils.createStream(accounts[0], addresses[1], delegatedPerSecond.toNumber(), fromDate, toDate, ubi);
            const secondStreamId = await testUtils.createStream(accounts[0], addresses[2], delegatedPerSecond.toNumber(), fromDate, toDate, ubi);
            lastStreamId = secondStreamId;
            expect((await ubi.getStreamsCount(addresses[0])).toNumber()).to.eq(initialStreamCount.plus(2).toNumber(), "Stream count should have increased by 2");

            // Move blocktime to end of firss stream (2nd is the same)
            const firstStream = await ubi.getStream(firstStreamId);
            await testUtils.setNextBlockTime(firstStream.stopTime.toNumber(), network);

            // Accrued balance should be half UBI for both streamn
            const firstStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(firstStreamId, addresses[1], ubi)).toString());
            const secondStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(secondStreamId, addresses[2], ubi)).toString());
            expect(firstStreamBalance.toNumber()).to.eq(delegatedPerSecond.multipliedBy(3600).toNumber(), "Invalid balance of first stream");
            expect(secondStreamBalance.toNumber()).to.eq(delegatedPerSecond.multipliedBy(3600).toNumber(), "Invalid balance of second stream");

            // Withdraw streams to clear them from list
            await ubi.connect(accounts[1]).withdrawFromStream(firstStreamId.toString(), firstStreamBalance.toString());
            await ubi.connect(accounts[2]).withdrawFromStream(secondStreamId.toString(), secondStreamBalance.toString());
        });

        it("happy path - After a stream finishes, total pending delegated value should increase by the total balance of the stream", async () => {

            // Get the initial pending delegated value
            const initialPendingDelegatedValue = BigNumber((await ubi.getDelegatedAccruedValue(addresses[0])).toString());

            // Create a new stream
            const currentBlockTime = await testUtils.getCurrentBlockTime();
            const fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
            const toDate = moment(fromDate).add(1, "hour").toDate();

            // Create 1 streams with accruedPerSecond
            lastStreamId = await testUtils.createStream(accounts[0], addresses[1], accruedPerSecond.toNumber(), fromDate, toDate, ubi);

            // Move blocktime to end of stream
            const stream = await ubi.getStream(lastStreamId);
            await testUtils.setNextBlockTime(stream.stopTime.toNumber(), network);

            const finalStreamBalance = await testUtils.ubiBalanceOfStream(lastStreamId, addresses[1], ubi);
            expect(finalStreamBalance.toNumber()).to.eq(accruedPerSecond.multipliedBy(60 * 60).toNumber(), "Stream should increase its balance by 1 hour of UBI accruance")


            // Get the final pending delegated value
            const finalPendingDelegatedValue = BigNumber((await ubi.getDelegatedAccruedValue(addresses[0])).toString());

            // Should be equal to initial + 1 hour of UBI accruance
            expect(finalPendingDelegatedValue.toNumber()).to.eq(initialPendingDelegatedValue.plus(finalStreamBalance).toNumber(), "Pending delegated value should account for last finished stream.");

            // Withdraw streams to clear them from list
            await ubi.connect(accounts[1]).withdrawFromStream(lastStreamId.toString(), finalStreamBalance.toString());

        });

        it("happy path - Creating 1 streams with half accruedPerSecond should accrue half for the stream and half for the human.", async () => {
            setSubmissionIsRegistered(addresses[0], true);


            // Create a new stream with half ubiPerSecond
            const currentBlockTime = await testUtils.getCurrentBlockTime();
            const fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
            const toDate = moment(fromDate).add(1, "hour").toDate();

            // Delegate half of UBI per second
            const delegatedPerSecond = accruedPerSecond.div(2).toNumber();

            // Create 1 streams with half of accrued per second.
            lastStreamId = await testUtils.createStream(accounts[0], addresses[1], delegatedPerSecond, fromDate, toDate, ubi);

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
            expect(newHumanBalance.toNumber()).to.eq(prevhumanBalance.plus(delegatedPerSecond * 3600).toNumber(), "Human should accrue only half of UBI");
            expect(lastStreamBalance.toNumber()).to.eq(prevStreamBalance.plus(delegatedPerSecond * 3600).toNumber(), "Stream should accrue only half of UBI");

            await testUtils.clearAllStreamsFrom(accounts[0], ubi, network);
        })

        it("require fail - Creating more than `maxStreamsAllowed` on the same time window should fail", async () => {
            // Calculate corresponding ubi per second to delegate to each stream 
            const ubiPerSecondPerDelegate = accruedPerSecond.div(maxStreamsAllowed.toNumber());

            const streamsCount = BigNumber((await ubi.getStreamsCount(addresses[0])).toString());
            
            const availableStreams = maxStreamsAllowed.minus(streamsCount);
            expect(availableStreams.toNumber() > 0, "No available streams to run test");


            // Create a new stream with half ubiPerSecond
            const currentBlockTime = await testUtils.getCurrentBlockTime();
            const fromDate = moment(new Date(currentBlockTime * 1000)).add(10, "minutes").toDate();
            const toDate = moment(fromDate).add(1, "hour").toDate();

            const delegatesToCreate = availableStreams.toNumber() + 1;

            let testPassed = false;
            // Create multiple streams with same date period
            for (let i = 0; i < delegatesToCreate; i++) {
                // Address index is always i+1 to avoid self delegation
                const addressIndex = i + 1;
                // If this iteration is expectedd to fail
                if (addressIndex > availableStreams) {
                    await expect(testUtils.createStream(accounts[0], addresses[addressIndex], ubiPerSecondPerDelegate.toString(), fromDate, toDate, ubi))
                        .to.be.revertedWith("max streams exceeded");
                    // End the test
                    testPassed = true;
                    break;
                } else {
                    lastStreamId = await testUtils.createStream(accounts[0], addresses[addressIndex], ubiPerSecondPerDelegate.toNumber(), fromDate, toDate, ubi);
                }
            }

            await testUtils.clearAllStreamsFrom(accounts[0], ubi, network);
            expect(testPassed).to.eq(true);
        });

        it("happy path - Creating more than `maxStreamsAllowed` on different time should fail succeed", async () => {

            // Calculate corresponding ubi per second to delegate to each stream 
            const ubiPerSecondPerDelegate = accruedPerSecond.div(maxStreamsAllowed.toNumber());

            const streamsCount = BigNumber((await ubi.getStreamsCount(addresses[0])).toString());
            const availableStreams = maxStreamsAllowed.minus(streamsCount);
            expect(availableStreams.toNumber() > 0, "No available streams to run test");

            const delegatesToCreate = availableStreams.toNumber() + 1;

            let testPassed = false;
            // Create multiple streams with same date period
            lastStreamId = 0;
            for (let i = 0; i < delegatesToCreate; i++) {
                // If last Stream ID is set, move to the end of the stream
                if (lastStreamId) {
                    await testUtils.goToEndOfStream(lastStreamId, ubi, network);
                }
                // Get streams parameters
                const currentBlockTime = await testUtils.getCurrentBlockTime();
                const fromDate = moment(new Date(currentBlockTime * 1000)).add(10, "minutes").toDate();
                const toDate = moment(fromDate).add(1, "hour").toDate();

                // Address index is always i+1 to avoid self delegation
                const addressIndex = i + 1;
                // If this iteration is expectedd to fail
                if (addressIndex > availableStreams) {
                    await expect(testUtils.createStream(accounts[0], addresses[addressIndex], ubiPerSecondPerDelegate.toString(), fromDate, toDate, ubi))
                        .to.be.revertedWith("max streams exceeded");
                    // End the test
                    testPassed = true;
                    break;
                } else {
                    lastStreamId = await testUtils.createStream(accounts[0], addresses[addressIndex], ubiPerSecondPerDelegate.toNumber(), fromDate, toDate, ubi);
                }
            }

            await testUtils.clearAllStreamsFrom(accounts[0], ubi, network);
            expect(testPassed).to.eq(true);
        });

        it("require fail - Creating 2 overlaping streams that, when overlaped, sum more than the allowed ubiPerSecond should fail", async () => {
            setSubmissionIsRegistered(addresses[0], true);
            // Withdraw from all streams to clear the path for more tests
            const streamIds = await ubi.getStreamsOf(addresses[0]);

            // initial variables
            const currentBlockTime = await testUtils.getCurrentBlockTime();

            // Create a stream with total accrued per second
            const fromDate1 = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
            const toDate1 = moment(fromDate1).add(1, "hour").toDate();
            lastStreamId = await testUtils.createStream(accounts[0], addresses[1], accruedPerSecond.toNumber(), fromDate1, toDate1, ubi);

            // Create a second stream with total accrued per second but that starts after previous stream starts and beofre it finished
            const fromDate2 = moment(fromDate1).add(30, "minutes").toDate();
            const toDate2 = moment(fromDate2).add(1, "hour").toDate();
            await expect(testUtils.createStream(accounts[0], addresses[2], accruedPerSecond.toNumber(), fromDate2, toDate2, ubi))
                .to.be.revertedWith("Delegated value exceeds available balance for the given stream period");
        })

        it("require fail - Creating circular delegation should fail", async () => {
            // Move to the end of the last stream
            await testUtils.goToEndOfStream(lastStreamId, ubi, network);

            setSubmissionIsRegistered(addresses[0], true);
            setSubmissionIsRegistered(addresses[1], true);

            // initial variables
            const currentBlockTime = await testUtils.getCurrentBlockTime();

            // Create a stream with total accrued per second
            const fromDate1 = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
            const toDate1 = moment(fromDate1).add(1, "hour").toDate();
            lastStreamId = await testUtils.createStream(accounts[0], addresses[1], accruedPerSecond.toNumber(), fromDate1, toDate1, ubi);

            // Create another stream with inverse delegator and delegate
            await expect(testUtils.createStream(accounts[1], addresses[0], accruedPerSecond.toNumber(), fromDate1, toDate1, ubi))
                .to.be.revertedWith("Circular delegation not allowed.");
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

                // Delegate half of UBI per second
                const delegatedPerSecond = accruedPerSecond.div(2).toNumber();

                // Create 1 stream with accruedPerSecond.
                lastStreamId = await testUtils.createStream(accounts[0], addresses[1], delegatedPerSecond, fromDate, toDate, ubi);

                // Get the stream
                const stream = await ubi.getStream(lastStreamId);

                // Move blocktime to end of stream
                await testUtils.setNextBlockTime(stream.stopTime.toNumber() + 1, network);

                // Get balances
                const prevRecipientBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[1], ubi)).toString());
                const prevStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId, addresses[1], ubi)).toString());

                // Recipient withdraws balance 
                await ubi.connect(accounts[1]).withdrawFromStream(lastStreamId, prevStreamBalance.toString());

                // Balance was withdrawn from completed stream so it shouldnt exist any more
                await expect(testUtils.ubiBalanceOfStream(lastStreamId, addresses[1], ubi))
                    .to.be.revertedWith("stream does not exist");

                // New balance of recipient should be previous + streamBalance
                const newRecipientBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[1], ubi)).toString());
                expect(newRecipientBalance.toNumber()).to.eq(prevRecipientBalance.plus(prevStreamBalance).toNumber(), "Recipient balance should increase by the balance of the stream.");

            })

            it("happy path - After withdrawing from an active stream, balance should be 0 right after, but keep accruing until the end.", async () => {
                setSubmissionIsRegistered(addresses[0], true);

                // New stream will start in 1 minute and last for 1 hour
                const currentBlockTime = await testUtils.getCurrentBlockTime();
                const fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
                const toDate = moment(fromDate).add(1, "hour").toDate();

                // Create stream
                lastStreamId = await testUtils.createStream(accounts[0], addresses[1], accruedPerSecond.toNumber(), fromDate, toDate, ubi);

                // Go to start
                await testUtils.goToStartOfStream(lastStreamId, ubi, network);

                // Get balances
                const prevRecipientBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[1], ubi)).toString());
                const initialStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId, addresses[1], ubi)).toString());
                expect(initialStreamBalance.toNumber()).to.eq(0, "Initial stream balance should be 0");

                // Move fwd 30 mins
                await testUtils.goToMiddleOfStream(lastStreamId, ubi, network);

                // The new stream balance should be half a UBI (ubiPerSecond * 30 * 60).
                const currentStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId, addresses[1], ubi)).toString());
                expect(currentStreamBalance.toNumber()).to.eq(initialStreamBalance.plus(accruedPerSecond.multipliedBy(30 * 60)).toNumber(), "Stream accrued balance should be half a UBI.");

                // Withdraw the current stream balance *️⃣(this mines a block and moves blocktime by 1 second)
                await ubi.connect(accounts[0]).withdrawFromStream(lastStreamId, currentStreamBalance.toString());

                // New recipient balance should be the same as previous + current stream balance + 1 second (because of *️⃣)
                const newRecipientBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[1], ubi)).toString());
                expect(newRecipientBalance.toNumber()).to.eq(prevRecipientBalance.plus(currentStreamBalance).toNumber(), "After withdrawal, recipient balance should increase by the amount of withdrawn balance");

                // // Move to the end of the stream and check stream balance.
                await testUtils.goToEndOfStream(lastStreamId, ubi, network);
                // Forward 10 more seconds
                await testUtils.timeForward(10, network);

                // Final balance sholud be 29 minutes 59 seconds of accruance (because of *️⃣)
                const finalStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId, addresses[1], ubi)).toString());
                expect(finalStreamBalance.toNumber()).to.eq(accruedPerSecond.multipliedBy((30 * 60)).toNumber(), "After stream finishes, the balance should account for the withdrawn balance.");

            })

            it("require fail - Withdraw more than the stream balance while its active should fail", async () => {

                // Go to the end of the last created stream to clear the path for new test
                await testUtils.goToEndOfStream(lastStreamId, ubi, network);

                // New stream will start in 10 minutes and last for 1 hour
                const currentBlockTime = await testUtils.getCurrentBlockTime();
                const fromDate = moment(new Date(currentBlockTime * 1000)).add(10, "minutes").toDate();
                const toDate = moment(fromDate).add(1, "hour").toDate();

                // Create stream
                lastStreamId = await testUtils.createStream(accounts[0], addresses[1], accruedPerSecond.toNumber(), fromDate, toDate, ubi);


                // Go to start
                await testUtils.goToStartOfStream(lastStreamId, ubi, network);

                // Get balances
                const initialStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId, addresses[1], ubi)).toString());
                expect(initialStreamBalance.toNumber()).to.eq(0, "Initial stream balance should be 0");

                // Move to the middle of the stream
                await testUtils.goToMiddleOfStream(lastStreamId, ubi, network);

                // The new stream balance should be half a UBI (ubiPerSecond * 30 * 60).
                const currentStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId, addresses[1], ubi)).toString());
                expect(currentStreamBalance.toNumber()).to.eq(initialStreamBalance.plus(accruedPerSecond.multipliedBy(30 * 60)).toNumber(), "Stream accrued balance should be half a UBI.");

                // Withdraw the current stream balance + 2. (1 second for the mined block and 1 to pass the max balance)
                await expect(ubi.connect(accounts[0]).withdrawFromStream(lastStreamId, currentStreamBalance.plus(accruedPerSecond.multipliedBy(2)).toString()))
                    .to.be.revertedWith("amount exceeds the available balance");
            })

            it("require fail - Withdraw more than the stream balance after stream finished should fail", async () => {

                // Go to end of previous stream
                await testUtils.goToEndOfStream(lastStreamId, ubi, network);

                // Get balances
                let streamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId, addresses[1], ubi)).toString());
                expect(streamBalance.toNumber()).to.eq(accruedPerSecond.multipliedBy((60 * 60)).toNumber(), "Stream balance should be 30 minutes");

                // Try to withdrawy the total balance +1
                await expect(ubi.connect(accounts[0]).withdrawFromStream(lastStreamId, streamBalance.plus(accruedPerSecond).toString()))
                    .to.be.revertedWith("amount exceeds the available balance");
            })

            it("happy path - Withdraw in the middle of stream and after it finished should add the total delegated balance", async () => {

                // Create a new stream with half ubiPerSecond
                const currentBlockTime = await testUtils.getCurrentBlockTime();
                const fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
                const toDate = moment(fromDate).add(1, "hour").toDate();

                // Delegate half of UBI per second
                const delegatedPerSecond = accruedPerSecond.div(2);

                // Create 1 stream with accruedPerSecond.
                lastStreamId = await testUtils.createStream(accounts[0], addresses[1], delegatedPerSecond.toNumber(), fromDate, toDate, ubi);

                // Move blocktime to the middle of the stream
                await testUtils.goToMiddleOfStream(lastStreamId, ubi, network);

                // Get balances
                const prevRecipientBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[1], ubi)).toString());
                const prevStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId, addresses[1], ubi)).toString());

                // Recipient withdraws balance 
                await ubi.connect(accounts[1]).withdrawFromStream(lastStreamId, prevStreamBalance.toString());

                // New balance of stream should be ubiPerSecond * 1 second (withdraw mines and moves blocktime 1 second).
                const newStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId, addresses[1], ubi)).toString());
                expect(newStreamBalance.toNumber()).to.eq(delegatedPerSecond.toNumber(), "Stream balance should be of 1 second * delegatedPerSecond after withdrawal");

                // New balance of recipient should be previous + streamBalance
                const newRecipientBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[1], ubi)).toString());
                expect(newRecipientBalance.toNumber()).to.eq(prevRecipientBalance.plus(prevStreamBalance).toNumber(), "Recipient balance should increase by the withdrawn balance of the stream.");

                // Move to the end of the stream
                await testUtils.goToEndOfStream(lastStreamId, ubi, network);

                // Stream lasted 1 hour and withdraw was at 30 minutes of stream. Remaining balance should account for the remaining 30 minutes
                const remainingStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId, addresses[1], ubi)).toString());
                expect(remainingStreamBalance.toNumber()).to.eq(delegatedPerSecond.multipliedBy(30 * 60).toNumber(), "Stream balance should be delegatedPerSecond * 30 minutes");

                // Withdraw remaining balance.
                await ubi.connect(accounts[1]).withdrawFromStream(lastStreamId, remainingStreamBalance.toString());

                // Last balance of recipient should be the total of the stream (1 hour of delegatedPerSecond)
                const finalRecipientBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[1], ubi)).toString());
                expect(finalRecipientBalance.toNumber()).to.eq(prevRecipientBalance.plus(delegatedPerSecond.multipliedBy(60 * 60)).toNumber(), "Recipient balance should increase by the balance of the stream.");
            })

            it("happy path - After withdrawing from an ended stream, number of streams should decrease by 1", async () => {

                // Get number of streamsd
                const currentBlockTime = await testUtils.getCurrentBlockTime();
                const fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
                const toDate = moment(fromDate).add(1, "hour").toDate();

                // Create a new stream with half accruedPerSecond
                const delegatedPerSecond = accruedPerSecond.div(2);


                //  Get number of stream for the creator of stream 
                const initialStreamCount = BigNumber((await ubi.getStreamsCount(addresses[0])).toString());

                // Create 1 stream with accruedPerSecond as the total.
                lastStreamId = await testUtils.createStream(accounts[0], addresses[1], delegatedPerSecond.toNumber(), fromDate, toDate, ubi);

                //  Get number of stream for the creator of stream 
                const nextStreamCount = BigNumber((await ubi.getStreamsCount(addresses[0])).toString());
                expect(nextStreamCount.toNumber()).to.eq(initialStreamCount.plus(1).toNumber(), "Stream count should increase when user creates a new stream");

                // Move to the end of the stream
                await testUtils.goToEndOfStream(lastStreamId, ubi, network);

                // Get stream balance and expect it to be 1 UBI
                const streamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId, addresses[1], ubi)).toString());
                expect(streamBalance.toNumber()).to.eq(delegatedPerSecond.multipliedBy(60 * 60).toNumber(), "Stream balance should be 1 UBI");

                // Recipient withdraws balance 
                await ubi.connect(accounts[1]).withdrawFromStream(lastStreamId, streamBalance.toString());

                //  Get number of stream for the creator of stream 
                const lastStreamCount = BigNumber((await ubi.getStreamsCount(addresses[0])).toString());
                expect(lastStreamCount.toNumber()).to.eq(initialStreamCount.toNumber(), "Stream count should decrease after recipient withdraws from a completed stream");
            })

            it("happy path - While a stream is active, and sender transfers to another recipient, sender should have the right balance", async () => {

                // Create a new stream with half accruedPerSecond
                const currentBlockTime = await testUtils.getCurrentBlockTime();
                const fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
                const toDate = moment(fromDate).add(1, "hour").toDate();

                // Hald accruedPerSecond
                const delegatedPerSecond = accruedPerSecond.div(2);

                //  Get number of stream for the creator of stream 
                const initialStreamCount = BigNumber((await ubi.getStreamsCount(addresses[0])).toString());

                // Create 1 stream with accruedPerSecond as the total.
                lastStreamId = await testUtils.createStream(accounts[0], addresses[1], delegatedPerSecond.toNumber(), fromDate, toDate, ubi);

                //  Get number of stream for the creator of stream 
                const nextStreamCount = BigNumber((await ubi.getStreamsCount(addresses[0])).toString());
                expect(nextStreamCount.toNumber()).to.eq(initialStreamCount.plus(1).toNumber(), "Stream count should increase when user creates a new stream");

                // Go to start of stream
                await testUtils.goToStartOfStream(lastStreamId, ubi, network);

                // Get initial balance of sender
                const prevSenderBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[0], ubi)).toString());

                // Move to the end of the stream
                await testUtils.goToMiddleOfStream(lastStreamId, ubi, network);
                // Get new balance
                const middleSenderBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[0], ubi)).toString());
                const middleBlockTime = await testUtils.getCurrentBlockTime();

                // get the stream
                const stream = await ubi.getStream(lastStreamId);

                // Expect sender to have accrued the value of accruedPerSecond-delegatedPerSecond in half an hour
                expect(middleSenderBalance.toNumber()).to.eq(prevSenderBalance.plus(accruedPerSecond.minus(delegatedPerSecond).multipliedBy(middleBlockTime - stream.startTime.toNumber())).toNumber())

                // Transfer 1 UBI from account 0 to account 2
                const amountToTransfer = BigNumber(ethers.utils.parseEther("1").toString());
                const account2PrevBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[2], ubi)).toString());
                await ubi.connect(accounts[0]).transfer(addresses[2], amountToTransfer.toString());
                const account2NewBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[2], ubi)).toString());
                expect(account2NewBalance.toNumber()).to.eq(account2PrevBalance.plus(amountToTransfer).toNumber(), "After transfer account 2 should increase");

                // New balance of sender should be prevBalance - 1 UBI (+
                const afterTransferSenderBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[0], ubi)).toString());
                const expectedBalance = middleSenderBalance.minus(amountToTransfer).plus(accruedPerSecond.minus(delegatedPerSecond));
                expect(afterTransferSenderBalance.toNumber()).to.eq(expectedBalance.toNumber(), "After transfer sender's balance should have decreased by 1 UBI (+1 sec of accruance)");

                // Move to end of stream
                await testUtils.goToEndOfStream(lastStreamId, ubi, network);

                // Get current blocktime
                const endBlockTime = await testUtils.getCurrentBlockTime();

                // Get the current stream balance
                const streamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId, addresses[1], ubi)).toString());
                // Should be the delegatedPerSecond * stream duration
                expect(streamBalance.toNumber()).to.eq(delegatedPerSecond.multipliedBy(endBlockTime - stream.startTime.toNumber()).toNumber())
                // Recipient withdraws balance 
                await ubi.connect(accounts[1]).withdrawFromStream(lastStreamId, streamBalance.toString());

                //  Get number of stream for the creator of stream 
                const lastStreamCount = BigNumber((await ubi.getStreamsCount(addresses[0])).toString());
                expect(lastStreamCount.toNumber()).to.eq(initialStreamCount.toNumber(), "Stream count should decrease after recipient withdraws from a completed stream");
            })

            it("happy path - While a stream is active, and sender transferFrom UBI, sender should have the right balance", async () => {

                // Create a new stream with half accruedPerSecond
                const currentBlockTime = await testUtils.getCurrentBlockTime();
                const fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
                const toDate = moment(fromDate).add(1, "hour").toDate();

                // Hald accruedPerSecond
                const delegatedPerSecond = accruedPerSecond.div(2);

                //  Get number of stream for the creator of stream 
                const initialStreamCount = BigNumber((await ubi.getStreamsCount(addresses[0])).toString());

                // Create 1 stream with accruedPerSecond as the total.
                lastStreamId = await testUtils.createStream(accounts[0], addresses[1], delegatedPerSecond.toNumber(), fromDate, toDate, ubi);

                //  Get number of stream for the creator of stream 
                const nextStreamCount = BigNumber((await ubi.getStreamsCount(addresses[0])).toString());
                expect(nextStreamCount.toNumber()).to.eq(initialStreamCount.plus(1).toNumber(), "Stream count should increase when user creates a new stream");

                // Go to start of stream
                await testUtils.goToStartOfStream(lastStreamId, ubi, network);

                // Get initial balance of sender
                const prevSenderBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[0], ubi)).toString());

                // Move to the end of the stream
                await testUtils.goToMiddleOfStream(lastStreamId, ubi, network);
                // Get new balance
                const middleSenderBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[0], ubi)).toString());
                const middleBlockTime = await testUtils.getCurrentBlockTime();

                // get the stream
                const stream = await ubi.getStream(lastStreamId);

                // Expect sender to have accrued the value of accruedPerSecond-delegatedPerSecond in half an hour
                expect(middleSenderBalance.toNumber()).to.eq(prevSenderBalance.plus(accruedPerSecond.minus(delegatedPerSecond).multipliedBy(middleBlockTime - stream.startTime.toNumber())).toNumber())

                // Transfer 1 UBI from account 0 to account 2
                const amountToTransfer = BigNumber(ethers.utils.parseEther("1").toString());
                await ubi.connect(accounts[0]).approve(addresses[1], amountToTransfer.toString()); // +1 sec
                await ubi.connect(accounts[1]).transferFrom(addresses[0], addresses[1], amountToTransfer.toString()); // +1 sec

                // New balance of sender should be prevBalance - 1 UBI (+2 seconds (approve and transferFrom)
                const afterTransferSenderBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[0], ubi)).toString());
                const expectedBalance = middleSenderBalance.minus(amountToTransfer).plus(accruedPerSecond.minus(delegatedPerSecond).multipliedBy(2));
                expect(afterTransferSenderBalance.toNumber()).to.eq(expectedBalance.toNumber(), "After transferFrom, sender's balance should have decreased by 1 UBI (+1 sec of accruance)");

                // Move to end of stream
                await testUtils.goToEndOfStream(lastStreamId, ubi, network);

                // Get current blocktime
                const endBlockTime = await testUtils.getCurrentBlockTime();

                // Get the current stream balance
                const streamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId, addresses[1], ubi)).toString());
                // Should be the delegatedPerSecond * stream duration
                expect(streamBalance.toNumber()).to.eq(delegatedPerSecond.multipliedBy(endBlockTime - stream.startTime.toNumber()).toNumber())
                // Recipient withdraws balance 
                await ubi.connect(accounts[1]).withdrawFromStream(lastStreamId, streamBalance.toString());

                //  Get number of stream for the creator of stream 
                const lastStreamCount = BigNumber((await ubi.getStreamsCount(addresses[0])).toString());
                expect(lastStreamCount.toNumber()).to.eq(initialStreamCount.toNumber(), "Stream count should decrease after recipient withdraws from a completed stream");
            })

            it("happy path - While a stream is active, and sender burn UBI, sender should have the right balance", async () => {

                // Create a new stream with half accruedPerSecond
                const currentBlockTime = await testUtils.getCurrentBlockTime();
                const fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
                const toDate = moment(fromDate).add(1, "hour").toDate();

                // Hald accruedPerSecond
                const delegatedPerSecond = accruedPerSecond.div(2);

                //  Get number of stream for the creator of stream 
                const initialStreamCount = BigNumber((await ubi.getStreamsCount(addresses[0])).toString());

                // Create 1 stream with accruedPerSecond as the total.
                lastStreamId = await testUtils.createStream(accounts[0], addresses[1], delegatedPerSecond.toNumber(), fromDate, toDate, ubi);

                //  Get number of stream for the creator of stream 
                const nextStreamCount = BigNumber((await ubi.getStreamsCount(addresses[0])).toString());
                expect(nextStreamCount.toNumber()).to.eq(initialStreamCount.plus(1).toNumber(), "Stream count should increase when user creates a new stream");

                // Go to start of stream
                await testUtils.goToStartOfStream(lastStreamId, ubi, network);

                // Get initial balance of sender
                const prevSenderBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[0], ubi)).toString());

                // Move to the end of the stream
                await testUtils.goToMiddleOfStream(lastStreamId, ubi, network);
                // Get new balance
                const middleSenderBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[0], ubi)).toString());
                const middleBlockTime = await testUtils.getCurrentBlockTime();

                // get the stream
                const stream = await ubi.getStream(lastStreamId);

                // Expect sender to have accrued the value of accruedPerSecond-delegatedPerSecond in half an hour
                expect(middleSenderBalance.toNumber()).to.eq(prevSenderBalance.plus(accruedPerSecond.minus(delegatedPerSecond).multipliedBy(middleBlockTime - stream.startTime.toNumber())).toNumber())

                // Transfer 1 UBI from account 0 to account 2
                const amountToBurn = BigNumber(ethers.utils.parseEther("1").toString());
                await ubi.connect(accounts[0]).burn(amountToBurn.toString());

                // New balance of sender should be prevBalance - 1 UBI (+
                const afterTransferSenderBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[0], ubi)).toString());
                const expectedBalance = middleSenderBalance.minus(amountToBurn).plus(accruedPerSecond.minus(delegatedPerSecond));
                expect(afterTransferSenderBalance.toNumber()).to.eq(expectedBalance.toNumber(), "After burn, sender's balance should have decreased by 1 UBI (+1 sec of accruance)");

                // Move to end of stream
                await testUtils.goToEndOfStream(lastStreamId, ubi, network);

                // Get current blocktime
                const endBlockTime = await testUtils.getCurrentBlockTime();

                // Get the current stream balance
                const streamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId, addresses[1], ubi)).toString());
                // Should be the delegatedPerSecond * stream duration
                expect(streamBalance.toNumber()).to.eq(delegatedPerSecond.multipliedBy(endBlockTime - stream.startTime.toNumber()).toNumber())
                // Recipient withdraws balance 
                await ubi.connect(accounts[1]).withdrawFromStream(lastStreamId, streamBalance.toString());

                //  Get number of stream for the creator of stream 
                const lastStreamCount = BigNumber((await ubi.getStreamsCount(addresses[0])).toString());
                expect(lastStreamCount.toNumber()).to.eq(initialStreamCount.toNumber(), "Stream count should decrease after recipient withdraws from a completed stream");
            })

            it("happy path - While a stream is active, and sender burnFrom UBI, sender should have the right balance", async () => {

                // Create a new stream with half accruedPerSecond
                const currentBlockTime = await testUtils.getCurrentBlockTime();
                const fromDate = moment(new Date(currentBlockTime * 1000)).add(1, "minutes").toDate();
                const toDate = moment(fromDate).add(1, "hour").toDate();

                // Hald accruedPerSecond
                const delegatedPerSecond = accruedPerSecond.div(2);

                //  Get number of stream for the creator of stream 
                const initialStreamCount = BigNumber((await ubi.getStreamsCount(addresses[0])).toString());

                // Create 1 stream with accruedPerSecond as the total.
                lastStreamId = await testUtils.createStream(accounts[0], addresses[1], delegatedPerSecond.toNumber(), fromDate, toDate, ubi);

                //  Get number of stream for the creator of stream 
                const nextStreamCount = BigNumber((await ubi.getStreamsCount(addresses[0])).toString());
                expect(nextStreamCount.toNumber()).to.eq(initialStreamCount.plus(1).toNumber(), "Stream count should increase when user creates a new stream");

                // Go to start of stream
                await testUtils.goToStartOfStream(lastStreamId, ubi, network);

                // Get initial balance of sender
                const prevSenderBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[0], ubi)).toString());

                // Move to the end of the stream
                await testUtils.goToMiddleOfStream(lastStreamId, ubi, network);
                // Get new balance
                const middleSenderBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[0], ubi)).toString());
                const middleBlockTime = await testUtils.getCurrentBlockTime();

                // get the stream
                const stream = await ubi.getStream(lastStreamId);

                // Expect sender to have accrued the value of accruedPerSecond-delegatedPerSecond in half an hour
                expect(middleSenderBalance.toNumber()).to.eq(prevSenderBalance.plus(accruedPerSecond.minus(delegatedPerSecond).multipliedBy(middleBlockTime - stream.startTime.toNumber())).toNumber())

                // Transfer 1 UBI from account 0 to account 2
                const amountToBurn = BigNumber(ethers.utils.parseEther("1").toString());
                await ubi.connect(accounts[0]).approve(addresses[1], amountToBurn.toString()); // +1 sec
                await ubi.connect(accounts[1]).burnFrom(addresses[0], amountToBurn.toString()); // +1 sec

                // New balance of sender should be prevBalance - 1 UBI (+2 secs (approve and transferFrom)
                const afterTransferSenderBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[0], ubi)).toString());
                const expectedBalance = middleSenderBalance.minus(amountToBurn).plus(accruedPerSecond.minus(delegatedPerSecond).multipliedBy(2));
                expect(afterTransferSenderBalance.toNumber()).to.eq(expectedBalance.toNumber(), "After burn, sender's balance should have decreased by 1 UBI (+1 sec of accruance)");

                // Move to end of stream
                await testUtils.goToEndOfStream(lastStreamId, ubi, network);

                // Get current blocktime
                const endBlockTime = await testUtils.getCurrentBlockTime();

                // Get the current stream balance
                const streamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId, addresses[1], ubi)).toString());
                // Should be the delegatedPerSecond * stream duration
                expect(streamBalance.toNumber()).to.eq(delegatedPerSecond.multipliedBy(endBlockTime - stream.startTime.toNumber()).toNumber())
                // Recipient withdraws balance 
                await ubi.connect(accounts[1]).withdrawFromStream(lastStreamId, streamBalance.toString());

                //  Get number of stream for the creator of stream 
                const lastStreamCount = BigNumber((await ubi.getStreamsCount(addresses[0])).toString());
                expect(lastStreamCount.toNumber()).to.eq(initialStreamCount.toNumber(), "Stream count should decrease after recipient withdraws from a completed stream");
            })


        });

        //// STREAM CANCELLATION
        describe("UBI Stream cancellation", () => {

            it("happy path - Cancelling a stream that has not started should lower the stream count from sender", async () => {

                // Get stream count
                const initialStreamCount = BigNumber((await ubi.getStreamsCount(addresses[0])).toString());

                const initialBlockTime = await testUtils.getCurrentBlockTime();
                // Stream starts at current blocktime + 1 hour
                const fromDate = moment(new Date(initialBlockTime * 1000)).add(1, "hours").toDate();
                // Stream lasts 1 hours
                const toDate = moment(fromDate).add(1, "hour").toDate();

                // Create a stream from address 0 to address 1
                lastStreamId = await testUtils.createStream(accounts[0], addresses[1], accruedPerSecond.toNumber(), fromDate, toDate, ubi);

                // Move to start of the stream
                const stream = await ubi.getStream(lastStreamId);
                await testUtils.setNextBlockTime(BigNumber(stream.startTime.toString()).minus(1).toNumber(), network);

                // Get stream count
                const nextStreamCount = BigNumber((await ubi.getStreamsCount(addresses[0])).toString());
                expect(nextStreamCount.toNumber()).to.eq(initialStreamCount.plus(1).toNumber(), "Stream count should increase when a stream is created");

                // Cancel the stream
                await ubi.connect(accounts[0]).cancelStream(lastStreamId);

                // Get stream count. It should be equal to the previous count.
                const lastStreamCount = BigNumber((await ubi.getStreamsCount(addresses[0])).toString());
                expect(lastStreamCount.toNumber()).to.eq(initialStreamCount.toNumber(), "Stream count should decrease after a stream is cancelled");
            });

            it("happy path - Cancelling a stream that has already started should lower the stream count from sender", async () => {

                // Get stream count
                const initialStreamCount = BigNumber((await ubi.getStreamsCount(addresses[0])).toString());

                const initialBlockTime = await testUtils.getCurrentBlockTime();
                // Stream starts at current blocktime + 1 hour
                const fromDate = moment(new Date(initialBlockTime * 1000)).add(1, "hours").toDate();
                // Stream lasts 1 hours
                const toDate = moment(fromDate).add(1, "hour").toDate();

                // Create a stream from address 0 to address 1
                lastStreamId = await testUtils.createStream(accounts[0], addresses[1], accruedPerSecond.toNumber(), fromDate, toDate, ubi);

                // Move blocktime to the middle of the stream
                await testUtils.goToMiddleOfStream(lastStreamId, ubi, network);

                // Get stream count
                const nextStreamCount = BigNumber((await ubi.getStreamsCount(addresses[0])).toString());
                expect(nextStreamCount.toNumber()).to.eq(initialStreamCount.plus(1).toNumber(), "Stream count should increase when a stream is created");

                // Cancel the stream
                await ubi.connect(accounts[0]).cancelStream(lastStreamId);

                // Get stream count. It should be equal to the previous count.
                const lastStreamCount = BigNumber((await ubi.getStreamsCount(addresses[0])).toString());
                expect(lastStreamCount.toNumber()).to.eq(initialStreamCount.toNumber(), "Stream count should decrease after a stream is cancelled");
            });

            it("happy path - Cancelling a stream that already started should delete the streamId from the list of streamIds of the sender.", async () => {

                const initialBlockTime = await testUtils.getCurrentBlockTime();
                // Stream starts at current blocktime + 1 hour
                const fromDate = moment(new Date(initialBlockTime * 1000)).add(1, "hours").toDate();
                // Stream lasts 1 hours
                const toDate = moment(fromDate).add(1, "hour").toDate();

                // Create a stream from address 0 to address 1
                lastStreamId = await testUtils.createStream(accounts[0], addresses[1], accruedPerSecond.toNumber(), fromDate, toDate, ubi);

                // Get stream ids of sender
                const streamIds = await ubi.getStreamsOf(addresses[0]);
                expect(streamIds.find(streamId => streamId.toNumber() === lastStreamId.toNumber()) !== undefined, "Newly created stream id not found on list of sender's streamIds");

                // Move blocktime to the middle of the stream
                await testUtils.goToMiddleOfStream(lastStreamId, ubi, network);

                // Cancel the stream
                await ubi.connect(accounts[0]).cancelStream(lastStreamId);
                const newStreamIds = await ubi.getStreamsOf(addresses[0]);

                // Check that last stream id does not exists
                expect(newStreamIds.find(streamId => streamId.toNumber() === lastStreamId.toNumber()) === undefined, "Cancelled stream should not be on the list of sender's streamIds");
            });

            it("happy path - Cancelling a stream before it starts should not impact on sender accruance", async () => {

                const initialBlockTime = await testUtils.getCurrentBlockTime();
                // Stream starts at current blocktime + 1 hour
                const fromDate = moment(new Date(initialBlockTime * 1000)).add(1, "hours").toDate();
                // Stream lasts 1 hours
                const toDate = moment(fromDate).add(1, "hour").toDate();

                // Create a stream from address 0 to address 1
                lastStreamId = await testUtils.createStream(accounts[0], addresses[1], accruedPerSecond.toNumber(), fromDate, toDate, ubi);

                // Get previous Stream balance
                const prevStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId.toString(), addresses[1], ubi)).toString())
                expect(prevStreamBalance.toNumber()).to.eq(0, "Initial stream balance should be 0");

                // Get stream
                const stream = await ubi.getStream(lastStreamId);

                const prevRecipientBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[1], ubi)).toString());

                // Move to start of the stream - 1 sec (cancellation moves 1 second forward)
                await testUtils.setNextBlockTime(stream.startTime.toNumber() - 1, ubi, network);

                // Get starting Stream balance
                const startingStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId.toString(), addresses[1], ubi)).toString())
                expect(startingStreamBalance.toNumber()).to.eq(0, "Stream balance at start time should be 0");

                // Get previous human balance 
                const prevHumanBalance = await testUtils.ubiBalanceOfWallet(addresses[0], ubi);

                // Cancel the stream (mines a block so consolidated balance will add +1 sec of ubi to the stream)
                await ubi.connect(accounts[0]).cancelStream(lastStreamId);
                const recipientBalanceAfterCancel = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[1], ubi)).toString());
                expect(recipientBalanceAfterCancel.toNumber()).to.eq(prevRecipientBalance.toNumber(), "Recipient balance should not change if cancelled stream did not start");

                // Move to end of the stream
                await testUtils.setNextBlockTime(stream.stopTime.toNumber(), network);

                // After 1 hour (and 1 second of the mined block on cancel), Human should have accrued 1  UBI
                const currHumanBalance = await testUtils.ubiBalanceOfWallet(addresses[0], ubi);
                const expectedHumanBalance = prevHumanBalance.plus(accruedPerSecond.multipliedBy((stream.stopTime.toNumber() - stream.startTime.toNumber()) + 1));
                expect(currHumanBalance.toNumber()).to.eq(expectedHumanBalance.toNumber(), "Human balance should normally accrue after cancelling a stream that didnt start");

                // Stream should not exist
                expect(testUtils.ubiBalanceOfStream(lastStreamId.toString(), addresses[1], ubi)).to.be.revertedWith("stream does not exist")
            });

            it("happy path - Cancelling right at the middle of a stream should withdraw the stream accrued balance to the recipient", async () => {

                const initialBlockTime = await testUtils.getCurrentBlockTime();
                // Stream starts at current blocktime + 1 hour
                const fromDate = moment(new Date(initialBlockTime * 1000)).add(1, "hours").toDate();
                // Stream lasts 1 hours
                const toDate = moment(fromDate).add(1, "hour").toDate();

                // Create a stream from address 0 to address 1
                lastStreamId = await testUtils.createStream(accounts[0], addresses[1], accruedPerSecond.toNumber(), fromDate, toDate, ubi);

                // Get previous Stream balance
                const prevStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId.toString(), addresses[1], ubi)).toString())
                expect(prevStreamBalance.toNumber()).to.eq(0, "Initial stream balance should be 0");

                // Move to start of the stream
                await testUtils.goToStartOfStream(lastStreamId, ubi, network);

                // Get previous human
                const prevHumanBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[0], ubi)).toString());
                // Get previous recipient balance 
                const prevRecipientBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[1], ubi)).toString());

                // Move blocktime to the middle of the stream
                await testUtils.goToMiddleOfStream(lastStreamId, ubi, network);

                // Get previous recipient balance 
                const middleStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId, addresses[1], ubi)).toString());

                // Cancel the stream (mines block and moves blocktime 1 second)
                await ubi.connect(accounts[0]).cancelStream(lastStreamId);

                // After 30 minutes, stream recipient should have accrued 0.5 UBI
                const newRecipientBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[1], ubi)).toString())
                expect(newRecipientBalance.toNumber()).to.eq(prevRecipientBalance.plus(middleStreamBalance.plus(accruedPerSecond.toNumber())).toNumber(), "Recipient balance should increase by 0.5 UBI after cancelling stream running half an hour");

                // After 30 minutes, Human should have accrued 1 secnd of UBI (because of the mined block on cancel stream)
                const currHumanBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[0], ubi)).toString());
                expect(currHumanBalance.toNumber()).to.eq(prevHumanBalance.toNumber(), "Human balance should not accrue while streaming all its accruedPerSecond.");

            });

            it("happy path - Updating max streams allowed should update the value on the contract", async () => {
                await ubi.connect(accounts[0]).setMaxStreamsAllowed(20);
                const maxStreamsAllowed = BigNumber((await ubi.maxStreamsAllowed()).toString());
                expect(maxStreamsAllowed.toNumber()).to.eq(20);
            })
        });
    }

    describe('UBI Coin and Proof of Humanity', ubiCoinTests);

    describe("UBI streams", ubiStreamTests);

    describe('UBI Coin after streams', ubiCoinTests);
});
