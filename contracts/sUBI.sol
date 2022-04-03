// SPDX-License-Identifier: MIT
pragma solidity 0.7.3;

/**
 * This code contains elements of ERC20BurnableUpgradeable.sol https://github.com/OpenZeppelin/openzeppelin-contracts-upgradeable/blob/master/contracts/token/ERC20/ERC20BurnableUpgradeable.sol
 * Those have been inlined for the purpose of gas optimization.
 */

import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "@openzeppelin/contracts/cryptography/ECDSA.sol";
import "./interfaces/ISUBI.sol";
import "./interfaces/IFUBI.sol";
import "./ReentrancyGuard.sol";
import "hardhat/console.sol";

/**
 * @title ProofOfHumanity Interface
 * @dev See https://github.com/Proof-Of-Humanity/Proof-Of-Humanity.
 */
interface IProofOfHumanity {
  function isRegistered(address _submissionID)
    external
    view
    returns (
      bool registered
    );
}

interface IUBI {
  function getAccruedSince(address _human) external view returns (uint256);
  function getProofOfHumanity() external view returns (address);
  function getAccruedPerSecond() external view returns (uint256);
  function balanceOfStream(uint256 streamId) external view returns (uint256);
  function getUbiOutflow(address _human) external view returns(uint256);
}

/**
 * @title Universal Basic Income
 * @dev UBI is an ERC20 compatible token that is connected to a Proof of Humanity registry.
 *
 * Tokens are issued and drip over time for every verified submission on a Proof of Humanity registry.
 * The accrued tokens are updated directly on every wallet using the `balanceOf` function.
 * The tokens get effectively minted and persisted in memory when someone interacts with the contract doing a `transfer` or `burn`.
 */
contract sUBI is ERC721, ISUBI, ReentrancyGuard  {

  using SafeMath for uint256;

  address public ubi;
  address public governor;

  /// @dev The Proof Of Humanity registry to reference.
  address public proofOfHumanity;
  
  /// @dev The last token ID issued.
  uint256 public lastTokenId = 0;

  /// @dev The stream objects identifiable by their unsigned integer ids.
  mapping(uint256 => Types.Stream) private streams;

  /// @dev A mapping containing UNORDERED lists of the stream ids of each sender.
  /// @notice This does not guarantee to contain valid streams. Some may be ended (not withdrawn).
  mapping (address => uint256[]) public streamIdsOf;

  /// @dev Maximum number of streams allowed.
  uint256 private _maxStreamsAllowed;

  mapping(address => uint256) public lockedRatePerSecond;

  /// @dev Caller can only be UBI contract
  modifier onlyUBI() {
    require(msg.sender == ubi, "caller is not UBI contract");
    _;
  }

  /// @dev Verifies that the sender has ability to modify governed parameters.
  modifier onlyByGovernor() {
    require(governor == msg.sender, "The caller is not the governor.");
    _;
  }

  constructor(address pUBI, address pGovernor, uint256 pMaxStreamsAllowed, string memory pName, string memory pSymbol) ERC721(pName, pSymbol) ReentrancyGuard() {
      _maxStreamsAllowed = pMaxStreamsAllowed;
      ubi = pUBI;
      proofOfHumanity = IUBI(ubi).getProofOfHumanity();
      governor = pGovernor;
  }

  /**
    * @notice Creates a new stream funded by `msg.sender` and sent to `recipient`.
    * @dev Throws if the recipient is the zero address, the contract itself or the caller.
    *  Throws if the start time is before `block.timestamp`.
    *  Throws if the stop time is before the start time.
    *  Throws if the duration calculation has a math error.
    *  Throws if the rate calculation has a math error.
    *  Throws if the next stream id calculation has a math error.
    *  Throws if the contract is not allowed to transfer enough tokens.
    *  Throws if there is a token transfer failure.
    * @param recipient The address towards which the stream is minted to
    * @param ubiPerSecond The amount of UBI to be streamed every second. MUST be <= accruedPerSecond
    * @param startTime The unix timestamp for when the stream starts.
    * @param stopTime The unix timestamp for when the stream stops.
    * @return The uint256 id of the newly created stream.
    */
  function createDelegation(address sender, address recipient, uint256 ubiPerSecond, uint256 startTime, uint256 stopTime, bool isCancellable)
      public
      override
      nonReentrant
      onlyUBI
      returns (uint256)
  {
      require(recipient != address(0), "stream to the zero address");
      require(recipient != address(this), "stream to the contract itself");
      require(recipient != sender, "stream to the caller");
      require(ubiPerSecond > 0, "UBI per second is zero");
      require(startTime > block.timestamp, "start time should be in the future");
      require(stopTime > startTime, "stop time before the start time");

      // Check that we are not exceeding the max allowed.
      require(streamIdsOf[sender].length + 1 <= _maxStreamsAllowed, "max streams exceeded");

      lastTokenId += 1;

      // Create the stream
      streams[lastTokenId] = Types.Stream({
        // how many UBI to delegate per second.
        ratePerSecond: ubiPerSecond,
        // Starts with 0. Accumulates as time passes.
        isActive: true,
        sender: sender,
        startTime: startTime,
        stopTime: stopTime,
        accruedSince: 0,
        isCancellable: isCancellable
      });

      streamIdsOf[sender].push(lastTokenId);

      _safeMint(recipient, lastTokenId);

      lockedRatePerSecond[sender] = lockedRatePerSecond[sender].add(ubiPerSecond);

      emit CreateDelegation(sender, lastTokenId, ubiPerSecond, startTime, stopTime);
      return lastTokenId;
  } 

  function setUBI(address pUBI) public onlyUBI {
    ubi = pUBI;
  }

  /// @dev Deletes the given stream from related variables
  function deleteStream(uint256 streamId) internal {
    Types.Stream memory stream = streams[streamId];

    // DELETE FROM streamIdsOf
    // Get the index of the last item
    uint256 indexOfLastItem = streamIdsOf[stream.sender].length - 1;

    // revert the locked rate per second
    lockedRatePerSecond[stream.sender] = lockedRatePerSecond[stream.sender].sub(stream.ratePerSecond);

    for(uint256 i = 0; i < streamIdsOf[stream.sender].length; i++) {
      // If stream is found
      if(streamIdsOf[stream.sender][i] == streamId) {
        // If it's not the last element on the array
        if(i < indexOfLastItem) {
          // Replace the found stream with the last element on the array
          streamIdsOf[stream.sender][i] = streamIdsOf[stream.sender][indexOfLastItem];
        }
        // Delete the last element on the list
        streamIdsOf[stream.sender].pop();
        break;
      }
    }
    
    // Disable the stream
    streams[streamId].isActive = false;
  }

  function _forceDeleteStream(uint256 streamId) private {
    deleteStream(streamId);
  }

  /// @dev Callback for when UBI contract has withdrawn from a Stream.
  function onWithdraw(uint256 streamId) public override onlyUBI returns (uint256) {
    uint256 withdrawnAmount = balanceOfStream(streamId);
    console.log("withdrawnAmount", withdrawnAmount);
    streams[streamId].accruedSince = Math.min(block.timestamp, streams[streamId].stopTime);
      // DELETE STREAM IF REQUIRED
      // If withdrawing all available balance and stream is completed, remove it from the list of streams
      if(block.timestamp >= streams[streamId].stopTime) {
        deleteStream(streamId);
      }

      return withdrawnAmount;
  }

    /// @dev Callback for when UBI contract has cancelled a stream.
    function cancelDelegation(uint256 streamId) public override onlyUBI {
      Types.Stream memory stream = streams[streamId];
      deleteStream(streamId);
      emit CancelDelegation(streamId, stream.sender, ownerOf(streamId));
    }

    

    /**
     * @dev Set the max number of stream allowed per human.
     */
    function setMaxStreamsAllowed(uint256 newValue) external onlyByGovernor {
      _maxStreamsAllowed = newValue;
    }

    /**
     * @notice Returns either the delta in seconds between `block.timestamp` and `startTime` or
     *  between `stopTime` and `startTime, whichever is smaller. If `block.timestamp` is before
     *  `startTime`, it returns 0.
     * @dev Throws if the id does not point to a valid stream.
     * @param streamId ID of the stream for which to query the delta.
     */
    function accruedTime(uint256 streamId) public override view returns (uint256) {
      Types.Stream memory stream = streams[streamId];

      // If stream has not started, or it has been accrued all.
      if (block.timestamp < stream.startTime) return 0; // Stream not started
      if(stream.accruedSince >= stream.stopTime) return 0; // All stream withdrawn
        
      uint256 accrualStart = Math.max(stream.startTime, stream.accruedSince);
      return Math.min(stream.stopTime, block.timestamp).sub(accrualStart);
    }

    /**
     * @notice Returns the available funds for the given stream id and address.
     * @dev Throws if the id does not point to a valid stream.
     * @param streamId The id of the stream for which to query the balance.
     */
    function balanceOfStream(uint256 streamId) public override view returns (uint256) {
        Types.Stream memory stream = streams[streamId];
        if(!stream.isActive) return 0;

        if(!IProofOfHumanity(proofOfHumanity).isRegistered(stream.sender)) return 0;
        if(stream.startTime > block.timestamp) return 0;

        // Time accumulated by the stream
        uint256 streamAccumulatedTime = accruedTime(streamId);

        // UBI accrued by the scream
        uint256 streamAccruedValue = streamAccumulatedTime.mul(stream.ratePerSecond);
        return streamAccruedValue;
    }

    /**
     * @notice Returns the stream with all its properties.
     * @dev Throws if the id does not point to a valid stream.
     * @param streamId The id of the stream to query.
     */
    function getStream(uint256 streamId)
        external
        override
        view
        returns (uint256 ratePerSecond, // The rate of UBI to drip to this stream from the current accrued value
        uint256 startTime,
        uint256 stopTime,
        address sender,
        bool isActive,
        uint256 accruedSince,
        bool isCancellable)
    {
      Types.Stream memory stream = streams[streamId];
      return (stream.ratePerSecond,
        stream.startTime,
        stream.stopTime,
        stream.sender,
        stream.isActive,
        stream.accruedSince,
        stream.isCancellable);
    }

    function getStreamsCount(address _human) public view returns (uint256) {
      return streamIdsOf[_human].length;
    }

    function getStreamsOf(address _human) public override view returns (uint256[] memory) {
      return streamIdsOf[_human];
    }

    /**
     * @dev find out if 2 date ranges overlap
     */
    function overlapsWith(uint256 _startA, uint256 _endA, uint256 _startB, uint256 _endB) public pure returns (bool) {
      return (_startA <= _endB && _endA >= _startB);
    }

    function tokenURI(uint256 pTokenId) public view override returns(string memory) {
      return "";
      // Types.Stream storage stream = streams[pTokenId];
      // string memory metadataHeader = bytes(
      //   abi.encodePacked('{"description":"Streamed UBI from',string(stream.sender),'",', 
      //     //"external_url": "https://openseacreatures.io/3", 
      //     //"image": "https://storage.googleapis.com/opensea-prod.appspot.com/puffs/3.png", 
      //     '"name": "Streaming UBI",',
      //     '"attributes": [',
      //     '{"trait_type": "Sender", "value": "', stream.sender, '"},',
      //     '{"trait_type": "Start", "value": "', stream.startTime, '"},',
      //     '{"trait_type": "End", "value": "', stream.endTime, '"},',
      //     '{"trait_type": "Rate per second", "value": "', stream.ratePerSecond, '"},');

      // return string(
      //   abi.encodePacked(
      //     "data:application/json;base64,",
      //     Base64.encode(
      //       bytes(
      //         abi.encodePacked(
      //           '{"value":"',
      //           nftData.value,
      //           '", "tokenId":"',
      //           tokenId,
      //           '", "customValue":"',
      //           customValue,
      //           '", "imageLink": "',
      //           nftData.arweaveLink,
      //           '"}'
      //         )
      //       )
      //     )
      //   )
      // )
    } 

    /// @dev get the total number of active streams (present and future) generated by an account
    function getActiveStreamsOf(address _human) external override view returns (uint256[] memory) {
      // Preorder the array with the number of streams (since its the max size the retval could have).
      uint256[] memory activeStreams = new uint256[](streamIdsOf[_human].length);
      uint256 j = 0;
      for(uint256 i = 0; i < streamIdsOf[_human].length; i++) {
        if (streams[streamIdsOf[_human][i]].isActive) {
          activeStreams[j] = streamIdsOf[_human][i];
          j++;
        }
      }
      return activeStreams;
    }


    function maxStreamsAllowed() external override view returns (uint256) {
      return _maxStreamsAllowed;
    }

    // function getDelegatedValue(address _sender) public override view returns (uint256){
    //   uint256 delegatedBalance;
    //   for(uint256 i = 0; i < streamIdsOf[_sender].length; i++) {
    //     uint256 streamId = streamIdsOf[_sender][i];
    //     Types.Stream memory otherStream = streams[streamId];
    //     delegatedBalance = delegatedBalance.add(otherStream.ratePerSecond);
    //   }
    //   return delegatedBalance;
    // }

    function getDelegationInfo(uint256 delegationId) external override view returns (address sender, address recipient, uint256 ratePerSecond, bool isActive) {
      Types.Stream memory delegation = streams[delegationId];
      return (delegation.sender, ownerOf(delegationId), delegation.ratePerSecond, delegation.isActive);
    }

    /// @dev Streams accrue their value on the ERC721 token, not the recipient so this returns 0 always.
    function incomingTotalAccruedValue(address _human) external override view returns (uint256) {
      return 0;
    }

    /**
     * @dev gets the delegated accrued value.
     * This sums the accrued value of all active streams from the human's `accruedSince` to `block.timestamp`
     */
    function outgoingTotalAccruedValue(address _human) external override view returns (uint256)  {
      uint256 delegatedAccruedValue;
      // Iterate on each stream id of the human and calculate the currently delegated accrued value
      for(uint256 i = 0; i < streamIdsOf[_human].length; i++) {
        uint256 streamId = streamIdsOf[_human][i];

        Types.Stream memory stream = streams[streamId];
        if(!IProofOfHumanity(proofOfHumanity).isRegistered(stream.sender)) continue; // Sender is a registered human

        // Time delegated to the stream
        uint256 streamAccumulatedTime = accruedTime(streamId);
        console.log("streamAccumulatedTime", streamAccumulatedTime);

        // Stream's total accrued value is the accumulated time * stream's ratePerSecond
        // Add the stream accrued value to the pending delegated balance
        delegatedAccruedValue += streamAccumulatedTime.mul(stream.ratePerSecond);
      }
      return delegatedAccruedValue;
    }

    // function outgoingTotalAccruedValue(address _human) external override view returns (uint256) {
    //   uint256 accruedSince = IUBI(ubi).getAccruedSince(_human);
    //   uint256 delegatedBalance;
    //   for(uint256 i = 0; i < streamIdsOf[_human].length; i++) {
    //     uint256 streamId = streamIdsOf[_human][i];
    //     Types.Stream memory otherStream = streams[streamId];
    //     // If streams overlap subtract the delegated balance from the available ubi per second
    //     if(overlapsWith(otherStream.startTime, otherStream.stopTime, accruedSince, block.timestamp)) {
    //       delegatedBalance = delegatedBalance.add(otherStream.ratePerSecond);
    //     }
    //   }
    //   return delegatedBalance;
    // }

    function onReportRemoval(address _human) external override {
      // TODO: Define reportRemoval behavior
    }

    // THIS MIGHT 
    function getDelegatedRate(address _human) external override view returns(uint256) {
      return lockedRatePerSecond[_human];      
    }

    function pendingDelegatedTime(address _human) external override view returns(uint256) {
      uint256 delegatedAccruedValue;
      // Iterate on each stream id of the human and calculate the currently delegated accrued value
      for(uint256 i = 0; i < streamIdsOf[_human].length; i++) {
        uint256 streamId = streamIdsOf[_human][i];

        Types.Stream memory stream = streams[streamId];
        if(!IProofOfHumanity(proofOfHumanity).isRegistered(stream.sender)) continue; // Sender is a registered human

        // Time delegated to the stream
        uint256 streamAccumulatedTime = accruedTime(streamId);
        console.log("streamAccumulatedTime", streamAccumulatedTime);

        // Stream's total accrued value is the accumulated time * stream's ratePerSecond
        // Add the stream accrued value to the pending delegated balance
        delegatedAccruedValue += streamAccumulatedTime.mul(stream.ratePerSecond);
      }
      return delegatedAccruedValue;
    }

    // function newSupplyFrom(address _human) external override view returns (uint256) {
    //   uint256 delegatedBalance;
    //   for(uint256 i = 0; i < streamIdsOf[_sender].length; i++) {
    //     uint256 streamId = streamIdsOf[_sender][i];
    //     Types.Stream memory otherStream = streams[streamId];
    //     // If streams overlap subtract the delegated balance from the available ubi per second
    //     if(overlapsWith(otherStream.startTime, otherStream.stopTime, startTime, stopTime)) {
    //       delegatedBalance = delegatedBalance.add(otherStream.ratePerSecond);
    //     }
    //   }
    //   return delegatedBalance;
    // }

    // function onReportRemoval(address _human) public override {

    //   // Get active streams of human
    //     uint256[] memory activeStreamIds = this.getActiveStreamsOf(_human);
    //     // On each stream, withdraw and cancel the stream
    //     for(uint256 i = 0; i < activeStreamIds.length; i++) {
    //       uint256 streamId = activeStreamIds[i];
    //         // Withdraw funds from the stream and delete it
    //         _withdrawFromStream(streamId, msg.sender);
    //         // Delete the stream
    //         onCancelDelegation(streamId);

    //     }
    // }

    // /// @dev Withdraws from the contract to the recipient's account. If the recipient is address 0, it withdraws to the holder of the stream NFT token. 
    // function _withdrawFromStream(uint256 streamId, address recipient) private {
    //   // Get stream

    //   (uint256 ratePerSecond, uint256 startTime,
    //     uint256 stopTime, address sender, 
    //     bool isActive, uint256 streamAccruedSince, bool isCancellable) = subi.getStream(streamId);

    //   require(isActive, "stream not active");
    //   // Make sure stream is active and has accrued UBI
    //   if(block.timestamp < startTime || stopTime < streamAccruedSince) return;
      
    //   uint256 streamBalance = subi.balanceOfStream(streamId);

    //   // Consolidate sender balance
    //   uint256 newSupplyFrom;
    //   uint256 humanAccruedSince = accruedSince[sender];
      
    //   if (humanAccruedSince > 0 && proofOfHumanity.isRegistered(sender)) {
          
    //       newSupplyFrom = getTotalDelegatedValue(sender);
    //       uint256 receivingDelegatedValue = ubiInflow[sender].mul(block.timestamp.sub(humanAccruedSince));

    //       totalSupply = totalSupply.add(newSupplyFrom).add(receivedAccruedValue);

    //       ubiBalance[sender] = balanceOf(sender);

    //       // Update accruedSince
    //       accruedSince[sender] = block.timestamp;
    //   }        
    //   // Consolidate stream balance.
    //   address realRecipient = recipient;
    //   if(recipient == address(0)) {
    //     realRecipient = subi.ownerOf(streamId);
    //   }

    //   ubiBalance[realRecipient] = ubiBalance[realRecipient].add(streamBalance);
    //   subi.onWithdrawnFromStream(streamId);
    // }
}