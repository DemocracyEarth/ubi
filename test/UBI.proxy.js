const { default: BigNumber } = require("bignumber.js");
const { expect } = require("chai");
const deploymentParams = require('../deployment-params');
const { signERC2612Permit } = require("eth-permit");
const testUtils = require("./testUtils");
const moment = require("moment");
const { network, upgrades } = require("hardhat");

const ONE_HOUR = 3600;
const TWO_HOURS = 3600 * 2;

let accounts;

/**
 @summary Tests for UBI.sol
*/
const skipAll = false;
const skipStreams = true;
contract('UBI.sol', skipAll ? function () { } : function (accounts) {
    before(async () => {
        accounts = await ethers.getSigners();

        [_addresses, mockProofOfHumanity] = await Promise.all([
            Promise.all(accounts.map((account) => account.getAddress())),
            waffle.deployMockContract(
                accounts[0],
                require("../artifacts/contracts/UBI.sol/IProofOfHumanity.json").abi
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

        UBICoin = await ethers.getContractFactory("UBI");
        ubi = await upgrades.upgradeProxy(ubi.address, UBICoin);
        await ubi.deployed();

        // Initialize values on upgraded contract.
        await ubi.upgrade();

        altProofOfHumanity = await waffle.deployMockContract(accounts[0], require("../artifacts/contracts/UBI.sol/IProofOfHumanity.json").abi);

        // Global contract variables
        accruedPerSecond = BigNumber((await ubi.accruedPerSecond()).toString());
        // maxStreamsAllowed = BigNumber((await ubi.maxStreamsAllowed()).toString());

        // Set zero address as not registered
        setSubmissionIsRegistered(ethers.constants.AddressZero, false);

        permitDomain = {
            name: await ubi.name(),
            version: "2",
            chainId: (await ethers.provider.getNetwork()).chainId,
            verifyingContract: ubi.address
        };
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

        it("require fail - permit signature expired", async () => {
            const owner = accounts[0];
            const spender = accounts[1];
            const deadline = 0;
            const value = ethers.utils.parseEther('2').toString();

            expect((await ubi.allowance(owner.address, spender.address))).to.be.equal('0');

            const signature = await signERC2612Permit(
                owner.provider,
                permitDomain,
                owner.address,
                spender.address,
                value,
                deadline
            );

            await expect(
                ubi.permit(owner.address, spender.address, value, deadline, signature.v, signature.r, signature.s)
            ).to.be.revertedWith("ERC20Permit: expired deadline");

            expect((await ubi.allowance(owner.address, spender.address))).to.be.equal('0');
        });

        it("happy path - permit increases allowance to expected value", async () => {
            const owner = accounts[0];
            const spender = accounts[1];
            const value = ethers.utils.parseEther('2').toString();

            expect((await ubi.allowance(owner.address, spender.address))).to.be.equal('0');

            const signature = await signERC2612Permit(
                owner.provider,
                permitDomain,
                owner.address,
                spender.address,
                value
            );

            await ubi.permit(
                owner.address, spender.address, value, signature.deadline, signature.v, signature.r, signature.s
            );

            expect((await ubi.allowance(owner.address, spender.address))).to.be.equal(value);
        });

        it("require fail - permit signature already used", async () => {
            const owner = accounts[0];
            const spender = accounts[1];
            const expectedAllowanceBeforePermit = ethers.utils.parseEther('2').toString();
            const value = ethers.utils.parseEther('3').toString();

            expect((await ubi.allowance(owner.address, spender.address))).to.be.equal(expectedAllowanceBeforePermit);

            const signature = await signERC2612Permit(
                owner.provider,
                permitDomain,
                owner.address,
                spender.address,
                value
            );

            await ubi.permit(
                owner.address, spender.address, value, signature.deadline, signature.v, signature.r, signature.s
            );

            expect((await ubi.allowance(owner.address, spender.address))).to.be.equal(value);

            await expect(
                ubi.permit(owner.address, spender.address, value, signature.deadline, signature.v, signature.r, signature.s)
            ).to.be.revertedWith("ERC20Permit: invalid signature");

            expect((await ubi.allowance(owner.address, spender.address))).to.be.equal(value);
        });

        it("happy path - permit setting allowance to zero", async () => {
            const owner = accounts[0];
            const spender = accounts[1];
            const expectedAllowanceBeforePermit = ethers.utils.parseEther('3').toString();

            expect((await ubi.allowance(owner.address, spender.address))).to.be.equal(expectedAllowanceBeforePermit);

            const signature = await signERC2612Permit(
                owner.provider,
                permitDomain,
                owner.address,
                spender.address,
                '0'
            );

            await ubi.permit(
                owner.address, spender.address, 0, signature.deadline, signature.v, signature.r, signature.s
            );

            expect((await ubi.allowance(owner.address, spender.address))).to.be.equal('0');
        });

        it("require fail - permit signature built with invalid nonce", async () => {
            const owner = accounts[0];
            const spender = accounts[1];
            const value = ethers.utils.parseEther('3').toString();
            const currentNonce = await ubi.nonces(owner.address);
            const invalidNonce = currentNonce + 1;

            expect((await ubi.allowance(owner.address, spender.address))).to.be.equal('0');

            const signature = await signERC2612Permit(
                owner.provider,
                permitDomain,
                owner.address,
                spender.address,
                value,
                null,
                invalidNonce
            );

            await expect(
                ubi.permit(owner.address, spender.address, value, signature.deadline, signature.v, signature.r, signature.s)
            ).to.be.revertedWith("ERC20Permit: invalid signature");

            expect((await ubi.allowance(owner.address, spender.address))).to.be.equal('0');
        });

        it("require fail - permit with owner as zero address", async () => {
            const owner = accounts[0];
            const spender = accounts[1];
            const value = ethers.utils.parseEther('3').toString();
            const invalidOwner = ethers.constants.AddressZero;

            expect((await ubi.allowance(owner.address, spender.address))).to.be.equal('0');

            const signature = await signERC2612Permit(
                owner.provider,
                permitDomain,
                owner.address,
                spender.address,
                value
            );

            await expect(
                ubi.permit(invalidOwner, spender.address, value, signature.deadline, signature.v, signature.r, signature.s)
            ).to.be.revertedWith("ERC20Permit: invalid owner");

            expect((await ubi.allowance(owner.address, spender.address))).to.be.equal('0');
        });

        it("happy path - permit called by a third party increases allowance to expected value", async () => {
            const owner = accounts[0];
            const spender = accounts[1];
            const thirdParty = accounts[2];
            const value = ethers.utils.parseEther('2').toString();

            expect((await ubi.allowance(owner.address, spender.address))).to.be.equal('0');

            const signature = await signERC2612Permit(
                owner.provider,
                permitDomain,
                owner.address,
                spender.address,
                value
            );

            await ubi.connect(thirdParty).permit(
                owner.address, spender.address, value, signature.deadline, signature.v, signature.r, signature.s
            );

            expect((await ubi.allowance(owner.address, spender.address))).to.be.equal(value);
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

        //// WITHDRAWAL TEST
        describe("UBI stream withdrawals", () => {

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
                const streamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId, ubi)).toString());
                // Should be the delegatedPerSecond * stream duration
                expect(streamBalance.toNumber()).to.eq(delegatedPerSecond.multipliedBy(endBlockTime - stream.startTime.toNumber()).toNumber())
                // Recipient withdraws balance 
                await ubi.connect(accounts[1]).withdrawFromStream(lastStreamId);

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
                const streamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId, ubi)).toString());
                // Should be the delegatedPerSecond * stream duration
                expect(streamBalance.toNumber()).to.eq(delegatedPerSecond.multipliedBy(endBlockTime - stream.startTime.toNumber()).toNumber())
                // Recipient withdraws balance 
                await ubi.connect(accounts[1]).withdrawFromStream(lastStreamId);

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
                const prevStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId.toString(), ubi)).toString())
                expect(prevStreamBalance.toNumber()).to.eq(0, "Initial stream balance should be 0");

                // Get stream
                const stream = await ubi.getStream(lastStreamId);

                const prevRecipientBalance = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[1], ubi)).toString());

                // Move to 1 second before the start of the stream.
                await testUtils.setNextBlockTime(stream.startTime.toNumber() - 1, ubi, network);

                // Get starting Stream balance
                const startingStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId.toString(), ubi)).toString())
                expect(startingStreamBalance.toNumber()).to.eq(0, "Stream balance at start time should be 0");

                // Get a snapshot of the initial sender balance
                const initialSenderSnapshot = {
                    balance: await testUtils.ubiBalanceOfWallet(addresses[0], ubi),
                    timestamp: await testUtils.getCurrentBlockTime()
                }


                // Cancel the stream (mines a block so consolidated balance will add +1 sec of ubi to the stream)
                await ubi.connect(accounts[0]).cancelStream(lastStreamId);
                const recipientBalanceAfterCancel = BigNumber((await testUtils.ubiBalanceOfWallet(addresses[1], ubi)).toString());
                expect(recipientBalanceAfterCancel.toNumber()).to.eq(prevRecipientBalance.toNumber(), "Recipient balance should not change if cancelled stream did not start");

                // Move to end of the stream
                await testUtils.setNextBlockTime(stream.stopTime.toNumber(), network);

                // After 1 hour (and 1 second of the mined block on cancel), Human should have accrued 1  UBI
                const currentSenderBalance = await testUtils.ubiBalanceOfWallet(addresses[0], ubi);
                const expectedSenderBalance = initialSenderSnapshot.balance.plus(accruedPerSecond.multipliedBy((stream.stopTime.toNumber() - initialSenderSnapshot.timestamp)));
                expect(currentSenderBalance.toNumber()).to.eq(expectedSenderBalance.toNumber(), "Human balance should normally accrue after cancelling a stream that didnt start");

                // Stream should not exist
                expect(testUtils.ubiBalanceOfStream(lastStreamId.toString(), ubi)).to.be.revertedWith("stream does not exist")
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
                const prevStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId.toString(), ubi)).toString())
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
                const middleStreamBalance = BigNumber((await testUtils.ubiBalanceOfStream(lastStreamId, ubi)).toString());

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

    describe("UBI streams", skipStreams ? () => { } : ubiStreamTests);

    describe('UBI Coin after streams', skipStreams ? () => { } : ubiCoinTests);
});
