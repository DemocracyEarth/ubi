const BigNumber = web3.BigNumber;
const UBI = artifacts.require('UBI');

const {expect} = require("chai");

/*
require('chai')
  .use(require('chai-bignumber')(BigNumber))
  .should();
  
*/

contract('UBI', accounts => {
  const _name = "Democracy Earth";
  const _symbol = "UBI";
  // const _decimals = web3.utils.toBN('18');
  const _supply = 10000000 * 10**18;
  const _rate = 1;

 

  /* beforeEach(async () => {
    this.token = await UBI.new(_supply, _name, _symbol);
  }); */

  describe('UBI Coin deploy', () => {

    before(async () => {
      accounts = await ethers.getSigners();
  
      const [_addresses, mockProofOfHumanity] = await Promise.all([
        Promise.all(accounts.map((account) => account.getAddress())),
        waffle.deployMockContract(
          accounts[0],
          require("../artifacts/contracts/UBI.sol/IProofOfHumanity.json").abi
        ),
      ]);
      addresses = _addresses;
      setSubmissionIsRegistered = (submissionID, isRegistered) =>
        mockProofOfHumanity.mock.getSubmissionInfo
          .withArgs(submissionID)
          .returns(0, 0, 0, 0, isRegistered, false, 0);
  
      UBICoin = await (
        await ethers.getContractFactory("UBI")
      ).deploy(_supply, _name, _symbol, _rate, mockProofOfHumanity.address, 1);
  
      await UBICoin.deployed();
    });

    it("Allows the governor to change `accruedPerBlock`.", async () => {
      // Check that the value passed to the constructor is set.
      expect(await UBICoin.accruedPerBlock()).to.equal(1);
  
      // Make sure it reverts if we are not the governor.
      await expect(
        UBICoin.connect(accounts[1]).changeAccruedPerBlock(2)
      ).to.be.revertedWith("The caller is not the governor.");
  
      // Set the value to 2.
      await UBICoin.changeAccruedPerBlock(2);
      expect(await UBICoin.accruedPerBlock()).to.equal(2);
    });

/*
    it('has the correct name', async () => {
      const name = await this.token.name();
      name.should.equal(_name);
    });

    it('has the correct symbol', async () => {
      const symbol = await this.token.symbol();
      symbol.should.equal(_symbol);
    });

    it('has the correct decimals', async () => {
      const decimals = await this.token.decimals();
      decimals.should.be.bignumber.eql(_decimals);
    });
*/
  });
})