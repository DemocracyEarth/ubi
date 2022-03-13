const { default: BigNumber } = require("bignumber.js");
const { ethers, expect } = require("hardhat");
const logReader = require("./logReader");

const testUtils = {
  async createStream(fromAccount, toAddress, streamPerSecond, from, to, ubi, subi, verbose = false) {

    const fromSecs = testUtils.dateToSeconds(from);
    const toSecs = testUtils.dateToSeconds(to);
    const prevStreamId = new BigNumber((await subi.lastTokenId()).toString());

    const tx = await ubi.connect(fromAccount).createStream(toAddress, streamPerSecond, fromSecs, toSecs)
    await tx.wait();
    const events = await subi.queryFilter(subi.filters.CreateStream(fromAccount.address, toAddress));
    const createStreamEvents = logReader.getCreateStreamEvents(events);
    expect(createStreamEvents && createStreamEvents.length > 0, "createStream should emit event CreateStream");
    const streamId = createStreamEvents[createStreamEvents.length - 1].args[2];
    expect(streamId.toNumber()).to.eq(prevStreamId.plus(1).toNumber(), "CreateStream emited with incorrect streamId value")

    if (verbose) {
      console.log("Created stream:")
      console.log("Start:", fromSecs)
      console.log("End:", toSecs);
      console.log("Time Diff:", toSecs - fromSecs);
      console.log("Stream per second:", streamPerSecond);
    }
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

  async setNextBlockTime(time, network) {
    await network.provider.send("evm_setNextBlockTimestamp", [time])
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
  async ubiBalanceOfWallet(address, ubi) {
    return BigNumber((await ubi["balanceOf(address)"](address)).toString());
  },

  /**
   * Get consolidated balance of UBI on a human.
   * This means that gets the actual balance minus the accruedValue
   * ethers.js dopesnt support overload methods (because of the js nature).
   * UBI contract has 2 overloads of balanceOf. One for ERC-20 and one for EIP-1620 
   * @param {*} address 
   * @param {*} ubi 
   * @returns 
   */
  async ubiConsolidatedBalanceOfWallet(address, ubi) {
    const balance = BigNumber((await ubi["balanceOf(address)"](address)).toString());
    const accrued = BigNumber((await ubi.getAccruedValue(address)).toString());
    return balance.minus(accrued);
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
  },

  async goToStartOfStream(streamId, subi, network) {
    // Get the last created stream
    const stream = await subi.getStream(streamId);

    // Move to the end of the stream if needd
    if (await testUtils.getCurrentBlockTime() < stream.startTime.toNumber()) {
      await testUtils.setNextBlockTime(stream.startTime.toNumber(), network);
      expect(await testUtils.getCurrentBlockTime()).to.eq(stream.startTime.toNumber(), "Current block time should be the start of the stream");
    }
  },

  async goToMiddleOfStream(streamId, subi, network) {
    const stream = await subi.getStream(streamId);
    // Move to the middle of the stream
    const stopTime = BigNumber(stream.stopTime.toNumber());
    const startTime = BigNumber(stream.startTime.toNumber());
    const duration = stopTime.minus(startTime);
    await testUtils.setNextBlockTime(startTime.plus(duration.div(2)).toNumber(), network);
  },

  async goToEndOfStream(streamId, subi, network) {
    // Get the last created stream
    const stream = await subi.getStream(streamId);

    // Move to the end of the stream if needed
    if (await testUtils.getCurrentBlockTime() < stream.stopTime.toNumber()) {
      await testUtils.setNextBlockTime(stream.stopTime.toNumber(), network);
      expect(await testUtils.getCurrentBlockTime()).to.eq(stream.stopTime.toNumber(), "Current block time should be the end of the stream");
    }
  },

  async clearAllStreamsFrom(account, ubi, network) {
    // Withdraw from all streams to clear the path for more tests
    const streamIds = await ubi.getStreamsOf(account.address);
    for (let i = 0; i < streamIds.length; i++) {
      // Move to the end of stream.  `goToEndOfStream` is safe to use if end has passed already
      await testUtils.goToEndOfStream(streamIds[i].toNumber(), ubi, network);
      //const streamBalance = await testUtils.ubiBalanceOfStream(streamIds[i].toString(), stream.recipient, ubi);
      await ubi.connect(account).withdrawFromStream(streamIds[i].toString());
    }
  },

  async cancelAllStreamsFrom(account, ubi) {
    const streamIds = await ubi.getStreamsOf(account.address);
    for (let i = 0; i < streamIds.length; i++) {
      try {
        await ubi.connect(account).cancelStream(streamIds[i].toString());
      } catch (error) {
        // SKiop the error if its "not exists"
        if (!error.message.includes("'stream does not exist'")) {
          throw error;
        }
      }
    }
  }

}

module.exports = testUtils;