const { default: BigNumber } = require("bignumber.js");
const { ethers, expect } = require("hardhat");
const logReader = require("./logReader");

const testUtils = {
  async createStream(fromAccount, toAddress, streamPerSecond, from, to, ubi) {

    const prevStreamId = new BigNumber((await ubi.prevStreamId()).toString());
    const tx = await ubi.connect(fromAccount).createStream(toAddress, streamPerSecond, ubi.address, testUtils.dateToSeconds(from), testUtils.dateToSeconds(to))
    const result = await tx.wait();
    const createStreamEvents = logReader.getCreateStreamEvents(result.events);
    expect(createStreamEvents && createStreamEvents.length > 0, "createStream should emit event CreateStream");
    const streamId = createStreamEvents[0].args[0];
    expect(streamId.toNumber()).to.eq(prevStreamId.plus(1).toNumber(), "CreateStream emited with incorrect streamId value")
    return streamId;
    

    // const previousDelegate = await ubi.getDelegateOf(fromAccount.address);
    // const prevDelegateAccruingFactor = new BigNumber((await ubi.getAccruingFactor(previousDelegate)).toString());
    // const newDelegatePrevAccruingFactor = new BigNumber((await ubi.getAccruingFactor(toAddress)).toString());


    // // Delegate fromAccount to toAddress
    // await expect(ubi.connect(fromAccount).delegate(toAddress)).to.emit(ubi, "DelegateChange").withArgs(fromAccount.address, toAddress);
    // const delegate = await ubi.getDelegateOf(fromAccount.address);
    // expect(delegate).to.eq(toAddress, "Invalid delegate of");

    // if (delegate === ethers.constants.AddressZero)
    //   expect(await ubi.getInverseDelegateOf(delegate)).to.eq(ethers.constants.AddressZero, "Invalid inverse delegate of. Should be addres(0)");
    // else
    //   expect(await ubi.getInverseDelegateOf(delegate)).to.eq(fromAccount.address, "Invalid inverse delegate of.");


    // const newDelegateAccruingFactor = new BigNumber((await ubi.getAccruingFactor(toAddress)).toString());

    // if (toAddress !== ethers.constants.AddressZero) {
    //   // Human should have an accruing factor of 0
    //   expect(new BigNumber((await ubi.getAccruingFactor(fromAccount.address)).toString()).toNumber()).to.eq(0, "Human should have an accruing factor of 0 after delegating.");
    //   // Delegate should have an accruing factor of 1
    //   expect(newDelegateAccruingFactor.toNumber()).to.eq(newDelegatePrevAccruingFactor.plus(1).toNumber(), `Delegate ${toAddress} should have its accruing factor increased by 1 after being delegated`);
    // } else {
    //   // Human should have an accruing factor of 1 restored
    //   expect(new BigNumber((await ubi.getAccruingFactor(fromAccount.address)).toString()).toNumber()).to.eq(1, "Human should have an accruing factor of 1 after setting delegate as address 0.");
    //   // Previous delegate should have accruing factor reduced by 1
    //   expect(new BigNumber((await ubi.getAccruingFactor(previousDelegate)).toString()).toNumber()).to.eq(prevDelegateAccruingFactor.minus(1).toNumber(), "Previous delegate should have its accruing factor reduced by 1 after being removed as delegate.");
    // }
  },

  async timeForward(seconds, network) {
    await network.provider.send("evm_increaseTime", [seconds]);
    await network.provider.send("evm_mine");
  },

  dateToSeconds(date) {
    return Math.ceil(date.getTime() / 1000)
  },

  /**
   * Get balance of UBI on a human
   * ethers.js dopesnt support overload methods (because of the js nature).
   * UBI contract has 2 overloads of balanceOf. One for ERC-20 and one for EIP-1620 
   * @param {*} address 
   * @param {*} ubi 
   * @returns 
   */
  async ubiBalanceOfHuman(address, ubi) {
    return await ubi["balanceOf(address)"](address);
  },

  /**
   * Get accumulated balance of a stream
    * ethers.js dopesnt support overload methods (because of the js nature).
    * UBI contract has 2 overloads of balanceOf. One for ERC-20 and one for EIP-1620 
    * @param {*} streamId ID of the stream for which to get the balance.
    * @param {*} address Address of the sender or recipient for which to get the balance on the stream.
    * @param {*} ubi 
    * @returns 
    */
  async ubiBalanceOfStream(streamId, address, ubi) {
    return await ubi["balanceOf(uint256,address)"](streamId, address);
  },
  hoursToSeconds(hours) {
    return hours * 3600;
  },

  minutesToSeconds(minutes) {
    return minutes * 60;
  },

  async getCurrentBlockTime() {
    const blockNumber = await ethers.provider.getBlockNumber();
    const block = await ethers.provider.getBlock(blockNumber);
    return block.timestamp;
  }

}

module.exports = testUtils;