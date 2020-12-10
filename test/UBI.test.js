const BigNumber = web3.BigNumber;
const UBI = artifacts.require('UBI');

require('chai')
  .use(require('chai-bignumber')(BigNumber))
  .should();

contract('UBI', accounts => {
  const _name = "Democracy Earth";
  const _symbol = "UBI";
  const _decimals = web3.utils.toBN('18');
  const _supply = 10000;

  beforeEach(async () => {
    this.token = await UBI.new(_supply);
  });

  describe('token attribtues', () => {
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
  });
})