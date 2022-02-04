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
contract('UBI.sol', accounts => {
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
            [0, deploymentParams.TOKEN_NAME, deploymentParams.TOKEN_SYMBOL, 1000, mockProofOfHumanity.address],
            { initializer: 'initialize', unsafeAllowCustomTypes: true }
        );

        UBICoin = await ethers.getContractFactory("UBI");
        ubi = await upgrades.upgradeProxy(ubi.address, UBICoin);
        await ubi.deployed();

        // Initialize values on upgraded contract.
        await ubi.upgrade();

        // For testing purposes only, we define a max of 10 streams allowed
        await ubi.setMaxStreamsAllowed(10);

        altProofOfHumanity = await waffle.deployMockContract(accounts[0], require("../artifacts/contracts/UBI.sol/IProofOfHumanity.json").abi);

        // Global contract variables
        accruedPerSecond = BigNumber((await ubi.accruedPerSecond()).toString());
        maxStreamsAllowed = BigNumber((await ubi.maxStreamsAllowed()).toString());

        // Set zero address as not registered
        setSubmissionIsRegistered(ethers.constants.AddressZero, false);

        permitDomain = {
            name: await ubi.name(),
            version: "2",
            chainId: (await ethers.provider.getNetwork()).chainId,
            verifyingContract: ubi.address
        };
    });

    describe("UBI streams", () => {

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

        describe("deltaOf", () => {

            describe("deltaOf without withdrawal", () => {

                let lastStreamId;

                it("happy path - after creating a stream, deltaOf should return 0 if stream didnt start", async () => {
                    // ARRANGE
                    setSubmissionIsRegistered(accounts[0].address, true);
                    setSubmissionIsRegistered(addresses[1], false);


                    // Get current block time
                    const initialBlockTime = await testUtils.getCurrentBlockTime();
                    // Stream start 1 hour from now
                    const fromDate = moment(new Date(initialBlockTime * 1000)).add(1, "hours").toDate();
                    // Stream lasts 1 hour
                    const toDate = moment(fromDate).add(1, "hour").toDate();

                    // ACT
                    // Create stream
                    lastStreamId = await testUtils.createStream(accounts[0], addresses[1], 100, fromDate, toDate, ubi);

                    // ASSERT 
                    // Check that delta of return 0 (because stream didnt start). 
                    expect((await ubi.deltaOf(lastStreamId)).toNumber()).to.eq(0);
                })

                it("happy path - after moving to middle of stream, deltaOf should return 1800", async () => {

                    // ARRANGE / ACT
                    // Set block time to middle of stream,
                    await testUtils.goToMiddleOfStream(lastStreamId, ubi, network);

                    // ASSERT 
                    // Check that delta of returns 200.
                    expect((await ubi.deltaOf(lastStreamId)).toNumber()).to.eq(1800);
                })

                it("happy path - after stream is finished, deltaOf should return the 3600 seconds.", async () => {
                    // ARRANGE & ACT                
                    // Set block time to startTime + 200
                    await testUtils.goToEndOfStream(lastStreamId, ubi, network);

                    // ASSERT 
                    // Check that delta of returns 200.
                    expect((await ubi.deltaOf(lastStreamId)).toNumber()).to.eq(3600);
                })
            })

            describe("deltaOf with withdrawal", () => {

                let lastStreamId;

                // Cancel all streams to restart state
                before(async () => {
                    lastStreamId = await ubi.prevStreamId();
                    for (let i = 1; i <= lastStreamId; i++) {
                        try {
                            await ubi.cancelStream(i);
                        } catch (error) {
                            // SKiop the error if its "not exists"
                            if (!error.message.includes("'stream does not exist'")) {
                                throw error;
                            }
                        }
                    }
                })

                it("happy path - after creating a stream, moving to the middle of the stream, and withdrawing deltaOf should return 0 because all available accrued time was withdrawn", async () => {
                    // ARRANGE
                    setSubmissionIsRegistered(accounts[0].address, true);
                    setSubmissionIsRegistered(addresses[1], false);


                    // Get current block time
                    const initialBlockTime = await testUtils.getCurrentBlockTime();
                    // Stream start 1 hour from now
                    const fromDate = moment(new Date(initialBlockTime * 1000)).add(1, "hours").toDate();
                    // Stream lasts 1 hour
                    const toDate = moment(fromDate).add(1, "hour").toDate();

                    // ACT
                    // Create stream
                    lastStreamId = await testUtils.createStream(accounts[0], addresses[1], 100, fromDate, toDate, ubi);
                    await testUtils.goToStartOfStream(lastStreamId, ubi, network);
                    // move to mniddle of stream
                    await testUtils.goToMiddleOfStream(lastStreamId, ubi, network);
                    // widthdraw from stream
                    await ubi.withdrawFromStreams([lastStreamId]);

                    // ASSERT 
                    // Check that delta of return 0 (because stream didnt start). 
                    expect((await ubi.deltaOf(lastStreamId)).toNumber()).to.eq(0);
                })

                it("happy path - after stream is finished, deltaOf should return 1799 seconds.", async () => {
                    // ARRANGE / ACT
                    // Set block time to end of stream
                    await testUtils.goToEndOfStream(lastStreamId, ubi, network);

                    // ASSERT 
                    // Check that delta of returns 1799
                    // NOTE: Expected value is not 1800 because balance was withdrawn in the middle of stream and block time was moved 1 second when executing withdrawFromStream.                
                    expect((await ubi.deltaOf(lastStreamId)).toNumber()).to.eq(1799);
                })

                it("happy path - after stream is finished, and balance is withdrawn, deltaOf should return 0 seconds.", async () => {                // ARRANGE & ACT                
                    // ARRANGE                
                    // Set block time to end of stream
                    await testUtils.goToEndOfStream(lastStreamId, ubi, network);

                    // ACT
                    // widthdraw from stream the remaining balance
                    await ubi.withdrawFromStreams([lastStreamId]);

                    // ASSERT 
                    // deltaOf should return 0.
                    expect((await ubi.deltaOf(lastStreamId)).toNumber()).to.eq(0);
                })
            })
        });

        describe("getDelegatedAccruedValue", () => {

            describe("getDelegatedAccruedValue with single delegation", () => {


                describe("getDelegatedAccruedValue without withdrawal", () => {
                    let lastStreamId;

                    // Cancel all streams to restart state
                    before(async () => {
                        await testUtils.cancelAllStreamsFrom(accounts[0], ubi);
                    })

                    it("happy path - after creating a stream, getDelegatedAccruedValue should return 0 UBIwei", async () => {
                        // ARRANGE
                        setSubmissionIsRegistered(accounts[0].address, true);
                        setSubmissionIsRegistered(addresses[1], false);


                        // Get current block time
                        const initialBlockTime = await testUtils.getCurrentBlockTime();
                        // Stream start 1 hour from now
                        const fromDate = moment(new Date(initialBlockTime * 1000)).add(1, "hours").toDate();
                        // Stream lasts 1 hour
                        const toDate = moment(fromDate).add(1, "hour").toDate();

                        // ACT
                        // Create stream
                        lastStreamId = await testUtils.createStream(accounts[0], addresses[1], 100, fromDate, toDate, ubi);

                        // ASSERT 
                        // Check that delta of return 0 (because stream didnt start). 
                        expect((await ubi.getDelegatedAccruedValue(addresses[0])).toNumber()).to.eq(0);
                    })

                    it("happy path - after moving to middle of stream, getDelegatedValue should return 180000 UBIwei", async () => {

                        // ARRANGE & ACT
                        // Set block time to middle of stream
                        await testUtils.goToMiddleOfStream(lastStreamId, ubi, network);

                        // ASSERT 
                        // Check that delta of returns 200.
                        expect((await ubi.getDelegatedAccruedValue(addresses[0])).toNumber()).to.eq(180000);
                    })

                    it("happy path - after stream is finished, getDelegatedAccruedValue should return the 360000 UBIwei.", async () => {
                        // ARRANGE & ACT                
                        // Set block time to startTime + 200
                        await testUtils.goToEndOfStream(lastStreamId, ubi, network);

                        // ASSERT 
                        // Check that delta of returns 200.
                        expect((await ubi.getDelegatedAccruedValue(addresses[0])).toNumber()).to.eq(360000);
                    })
                })

                describe("getDelegatedAccruedValue with withdrawal", () => {
                    let lastStreamId;
                    // Cancel all streams to restart state
                    before(async () => {
                        await testUtils.cancelAllStreamsFrom(accounts[0], ubi);
                    })
                    it("happy path - after creating a stream, moving to the middle of stream and witrhdrawing, getDelegatedAccruedValue should return 0 UBIwei because pending balance was withdrawn", async () => {
                        // ARRANGE
                        setSubmissionIsRegistered(accounts[0].address, true);
                        setSubmissionIsRegistered(addresses[1], false);


                        // Get current block time
                        const initialBlockTime = await testUtils.getCurrentBlockTime();
                        // Stream start 1 hour from now
                        const fromDate = moment(new Date(initialBlockTime * 1000)).add(1, "hours").toDate();
                        // Stream lasts 1 hour
                        const toDate = moment(fromDate).add(1, "hour").toDate();

                        // ACT
                        // Create stream
                        lastStreamId = await testUtils.createStream(accounts[0], addresses[1], 100, fromDate, toDate, ubi);
                        // move to middle of stream
                        await testUtils.goToMiddleOfStream(lastStreamId, ubi, network);
                        // widthdraw from stream
                        await ubi.withdrawFromStreams([lastStreamId]);

                        // ASSERT 
                        // Check that getDelegatedAccruedValue of returns 0.
                        expect((await ubi.getDelegatedAccruedValue(addresses[0])).toNumber()).to.eq(0);
                    })

                    it("happy path - after stream is finished, getDelegatedAccruedValue should return the 179900 UBIwei.", async () => {
                        // ARRANGE & ACT                
                        // Go to end of stream,
                        await testUtils.goToEndOfStream(lastStreamId, ubi, network);

                        // ASSERT 
                        // Check that getDelegatedAccruedValue return 179900 (because withdraw from stream moves 1 secon further).
                        expect((await ubi.getDelegatedAccruedValue(addresses[0])).toNumber()).to.eq(179900);
                    })

                    it("happy path - after stream is finished, and balance is withdrawn, getDelegatedAccruedValue should return the 0 UBIwei.", async () => {
                        // ARRANGE & ACT                
                        // Stream should be at the end because of previous test
                        // widthdraw from stream
                        await ubi.withdrawFromStreams([lastStreamId]);

                        // ASSERT 
                        // Check that getDelegatedAccruedValue return 179900 (because withdraw from stream moves 1 secon further).
                        expect((await ubi.getDelegatedAccruedValue(addresses[0])).toNumber()).to.eq(0);
                    })
                })
            })

            describe("getDelegatedAccruedValue with multiple overlapping delegations", () => {

                describe("getDelegatedAccruedValue without withdrawals", () => {
                    let streamId1;
                    let streamId2;

                    // Cancel all streams to restart state
                    before(async () => {
                        await testUtils.cancelAllStreamsFrom(accounts[0], ubi);
                    })

                    it("happy path - creating 2 streams, with 30 minutes of difference, before any starts, getDelegatedAccruedValue should return 0 UBIwei", async () => {

                        // ARRANGE
                        setSubmissionIsRegistered(accounts[0].address, true);
                        setSubmissionIsRegistered(addresses[1], false);

                        // Get current block time
                        const initialBlockTime = await testUtils.getCurrentBlockTime();
                        // Streams start 1 hour from now
                        const fromDate1 = moment(new Date(initialBlockTime * 1000)).add(1, "hours").toDate();
                        const fromDate2 = moment(fromDate1).add(30, "minutes").toDate();
                        // Streams lasts 1 hour
                        const toDate1 = moment(fromDate1).add(1, "hour").toDate();
                        const toDate2 = moment(fromDate2).add(1, "hour").toDate();

                        // ACT
                        // Create stream
                        streamId1 = await testUtils.createStream(accounts[0], addresses[1], 100, fromDate1, toDate1, ubi);
                        streamId2 = await testUtils.createStream(accounts[0], addresses[2], 100, fromDate2, toDate2, ubi);

                        // ASSERT 
                        // Check that delta of return 0 (because stream didnt start). 
                        expect((await ubi.getDelegatedAccruedValue(addresses[0])).toNumber()).to.eq(0);
                    })

                    it("happy path - after moving to the middle of the 1st stream, getDelegatedAccruedValue should return 180000 UBIwei since the 2nd didnt started", async () => {

                        // ARRANGE / ACT
                        // Set block time to middle of first stream
                        await testUtils.goToMiddleOfStream(streamId1, ubi, network);

                        // ASSERT 
                        // Check that getDelegatedAccruedValue returns 180000 UBIwei
                        expect((await ubi.getDelegatedAccruedValue(addresses[0])).toNumber()).to.eq(180000);
                    })

                    it("happy path - after moving to the end of 1st stream, getDelegatedAccruedValue should return the 360000 + 180000 UBIwei (because the 2nd stream should be in the middle).", async () => {
                        // ARRANGE & ACT                
                        // Set block time to end of first stream
                        await testUtils.goToMiddleOfStream(streamId2, ubi, network);

                        // ASSERT 
                        // Check that delta of returns 360000 + 180000.
                        expect((await ubi.getDelegatedAccruedValue(addresses[0])).toNumber()).to.eq(360000 + 180000);
                    })

                    it("happy path - after moving to the end of 2nd stream, getDelegatedAccruedValue should return 360000 + 360000 UBIwei (because the 2nd stream should be in the middle).", async () => {
                        // ARRANGE & ACT                
                        // Set block time to end of second stream
                        await testUtils.goToEndOfStream(streamId2, ubi, network);

                        // ASSERT 
                        // Check that delta of returns 360000 + 360000.
                        expect((await ubi.getDelegatedAccruedValue(addresses[0])).toNumber()).to.eq(360000 + 360000);
                    })
                })

                describe("getDelegatedAccruedValue with withdrawals", () => {
                    let streamId1;
                    let streamId2;

                    // Cancel all streams to restart state
                    before(async () => {
                        await testUtils.cancelAllStreamsFrom(accounts[0], ubi);
                    })

                    it("happy path - creating 2 streams, with 30 minutes of difference, moving to middle of 1st and withdrawing, getDelegatedAccruedValue should return 100 UBIwei (because 1 second of withdrawn)", async () => {

                        // ARRANGE
                        setSubmissionIsRegistered(accounts[0].address, true);
                        setSubmissionIsRegistered(addresses[1], false);

                        // Get current block time
                        const initialBlockTime = await testUtils.getCurrentBlockTime();
                        // Streams start 1 hour from now
                        const fromDate1 = moment(new Date(initialBlockTime * 1000)).add(1, "hours").toDate();
                        const fromDate2 = moment(fromDate1).add(30, "minutes").add(1, "second").toDate(); // Add 1 second to compensate for mining times
                        // Streams lasts 1 hour
                        const toDate1 = moment(fromDate1).add(1, "hour").toDate();
                        const toDate2 = moment(fromDate2).add(1, "hour").toDate();

                        // ACT
                        // Create streams
                        streamId1 = await testUtils.createStream(accounts[0], addresses[1], 100, fromDate1, toDate1, ubi);
                        streamId2 = await testUtils.createStream(accounts[0], addresses[2], 100, fromDate2, toDate2, ubi);
                        // Move to middle of 1st stream
                        await testUtils.goToMiddleOfStream(streamId1, ubi, network);
                        // Withdraw from 1st stream
                        await ubi.withdrawFromStreams([streamId1]);

                        // ASSERT 
                        // getDelegatedAccruedValue should return 0
                        expect((await ubi.getDelegatedAccruedValue(addresses[0])).toNumber()).to.eq(0);
                    })


                    it("happy path - moving to the middle of stream 2, in which first stream is finished, getDelegatedAccruedValue should return 180000 + 179900 UBIwei.", async () => {
                        // ARRANGE & ACT                
                        // Go to end of stream,
                        await testUtils.goToMiddleOfStream(streamId2, ubi, network);

                        // ASSERT 
                        // Check that getDelegatedAccruedValue returns 179900 + 180000 (because withdraw from stream moves 1 second further).
                        expect((await ubi.getDelegatedAccruedValue(addresses[0])).toNumber()).to.eq(179900 + 180000);

                    })

                    it("happy path - after withdrawing from stream 2, which is at middle of stream, getDelegatedAccruedValue should return 179900 + 0 UBIwei.", async () => {
                        // ARRANGE & ACT                
                        await ubi.withdrawFromStreams([streamId2]);
                        
                        // ASSERT 
                        // Check that getDelegatedAccruedValue returns 179900 + 0 (because withdraw from stream moves 1 secon further).
                        expect((await ubi.getDelegatedAccruedValue(addresses[0])).toNumber()).to.eq(179900 + 0);
                    })

                })
            })

        })
    });
});