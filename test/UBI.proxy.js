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
    describe('UBI Coin and Proof of Humanity', () => {

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
    });

});
