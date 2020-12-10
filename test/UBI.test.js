const UBI = artifacts.require('UBI');

contract('UBI', accounts => {
  const _name = "Democracy Earth";
  const _symbol = "UBI";
  const _decimals = 18;
  const _supply = 10000;

  beforeEach(async () => {
    this.token = await UBI.new(_supply);
  });

  describe('token attribtues', () => {
    it('has the correct name', () => {

    });

    it('has the correct symbol', () => {

    });

    it('has the correct decimals', () => {

    });
  });
})