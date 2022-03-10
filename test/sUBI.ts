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

    // ARRANGE / ACT
    // Create stream
    const lastStreamId = await testUtils.createStream(sender,
      recipient.address,
      100,
      fromDate,
      toDate,
      ubi, sUBI);
    // Set block time to middle of stream,
    await testUtils.goToMiddleOfStream(lastStreamId, sUBI, network);

    // ASSERT 
    // Check that delta of returns 200.
    expect((await sUBI.accruedTime(lastStreamId)).toNumber()).to.eq(1800);
  })
});
