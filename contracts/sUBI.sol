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

  /// @dev The Proof Of Humanity registry to reference.
  address public proofOfHumanity;
  
  /// @dev The last token ID issued.
  uint256 public lastTokenId = 0;

  /// @dev The stream objects identifiable by their unsigned integer ids.
  mapping(uint256 => Types.Stream) private streams;

  /// @dev A mapping containing UNORDERED lists of the stream ids of each sender.
  /// @notice This does not guarantee to contain valid streams. Some may be ended (not withdrawn).
  mapping (address => uint256[]) public streamIdsOf;


  /// @dev Get the streamIds from human and recipient addresses.
  /// A recipient can have multiple streams with a sender.
  mapping (address => mapping(address => uint256[])) public streamIdsOfSenderAndRecipient;

  /// @dev Maximum number of streams allowed.
  uint256 private _maxStreamsAllowed;

  /// @dev Caller can only be UBI contract
  modifier onlyUBI() {
    require(msg.sender == ubi, "Caller is not UBI contract");
    _;
  }

  constructor(address pUBI, uint256 pMaxStreamsAllowed, string memory pName, string memory pSymbol) ERC721(pName, pSymbol) ReentrancyGuard() {
      _maxStreamsAllowed = pMaxStreamsAllowed;
      ubi = pUBI;
      proofOfHumanity = IUBI(ubi).getProofOfHumanity();
  }

  /**
    * @notice Creates a new stream funded by `msg.sender` and paid towards `recipient`.
    * @dev Throws if the recipient is the zero address, the contract itself or the caller.
    *  Throws if the start time is before `block.timestamp`.
    *  Throws if the stop time is before the start time.
    *  Throws if the duration calculation has a math error.
    *  Throws if the rate calculation has a math error.
    *  Throws if the next stream id calculation has a math error.
    *  Throws if the contract is not allowed to transfer enough tokens.
    *  Throws if there is a token transfer failure.
    * @param recipient The address towards which the money is streamed.
    * @param ubiPerSecond The amount of UBI to be streamed every second. MUST be <= accruedPerSecond
    * @param startTime The unix timestamp for when the stream starts.
    * @param stopTime The unix timestamp for when the stream stops.
    * @return The uint256 id of the newly created stream.
    */
  function mintStream(address sender, address recipient, uint256 ubiPerSecond, uint256 startTime, uint256 stopTime)
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
      require(ubiPerSecond <= IUBI(ubi).getAccruedPerSecond(), "Cannot delegate a value higher than accruedPerSecond");

      // Check that we are not exceeding the max allowed.
      require(streamIdsOf[sender].length + 1 <= _maxStreamsAllowed, "max streams exceeded");

      // Multiple streams to teh same recipient only allowed if none is active on the new stream's time period
      for(uint256 i = 0; i < streamIdsOfSenderAndRecipient[sender][recipient].length; i ++) {
        uint256 existingStreamId = streamIdsOfSenderAndRecipient[sender][recipient][i];
        if(existingStreamId > 0) require(
          !overlapsWith(startTime, stopTime, streams[existingStreamId].startTime, streams[existingStreamId].stopTime),
          "Account is already a recipient on an active or overlaping stream.");
      }

      // Avoid circular delegation validating that the recipient did not delegate to the sender
      for(uint256 i = 0 ; i < streamIdsOf[recipient].length; i++) {
        uint256 recipientStreamId = streamIdsOf[recipient][i];

        // If the recipient of this stream is the same as the sender and overlaps, fail with circular delegation exception
        if(recipientStreamId > 0 && streams[recipientStreamId].recipient == sender) {
          // Get overlap flag
          bool overlaps = overlapsWith(startTime, stopTime, streams[recipientStreamId].startTime, streams[recipientStreamId].stopTime);
          require(!overlaps, "Circular delegation not allowed.");
        }
      }

      // Calculate available balance to delegate for the given period.
      uint256 delegatedBalance;
      for(uint256 i = 0; i < streamIdsOf[sender].length; i++) {
        uint256 streamId = streamIdsOf[sender][i];
        Types.Stream memory otherStream = streams[streamId];
        // If streams overlap subtract the delegated balance from the available ubi per second
        if(overlapsWith(otherStream.startTime, otherStream.stopTime, startTime, stopTime)) {
            delegatedBalance = delegatedBalance.add(otherStream.ratePerSecond);
        }
      }

      require(ubiPerSecond <= IUBI(ubi).getAccruedPerSecond().sub(delegatedBalance), "Delegated value exceeds available balance for the given stream period");

      lastTokenId += 1;

      // Create the stream
      streams[lastTokenId] = Types.Stream({
        // how many UBI to delegate per second.
        ratePerSecond: ubiPerSecond,
        // Starts with 0. Accumulates as time passes.
        isEntity: true,
        recipient: recipient,
        sender: sender,
        startTime: startTime,
        stopTime: stopTime,
        accruedSince: 0
      });

      streamIdsOfSenderAndRecipient[sender][recipient].push(lastTokenId);
      streamIdsOf[sender].push(lastTokenId);

      _safeMint(recipient, lastTokenId);

      emit CreateStream(lastTokenId, sender, recipient, ubiPerSecond, startTime, stopTime);
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

    // DELETE FROM streamIds
    indexOfLastItem = streamIdsOfSenderAndRecipient[stream.sender][stream.recipient].length - 1;

    // For each stream with the recipient
    for(uint256 i = 0;i < streamIdsOfSenderAndRecipient[stream.sender][stream.recipient].length; i++) {
        // If stream is found
      if(streamIdsOfSenderAndRecipient[stream.sender][stream.recipient][i] == streamId) {
        // If it's not the last element on the array
        if(i < indexOfLastItem) {
          // Replace the found stream with the last element on the array
          streamIdsOfSenderAndRecipient[stream.sender][stream.recipient][i] = streamIdsOfSenderAndRecipient[stream.sender][stream.recipient][indexOfLastItem];
        }
        // Delete the last element on the list
        streamIdsOfSenderAndRecipient[stream.sender][stream.recipient].pop();
        break;
      }
    }

    // Delete the stream
    delete streams[streamId];
  }

  /// @dev Callback for when UBI contract has withdrawn from a Stream.
  function onWithdrawnFromStream(uint256 streamId, uint256 withdrawnBalance) public override onlyUBI {
    streams[streamId].accruedSince = Math.min(block.timestamp, streams[streamId].stopTime);
      // DELETE STREAM IF REQUIRED
      // If withdrawing all available balance and stream is completed, remove it from the list of streams
      if(block.timestamp >= streams[streamId].stopTime) {
        deleteStream(streamId);
      }

      //transfer(stream.recipient, amount);
      emit WithdrawFromStream(streamId, streams[streamId].recipient, withdrawnBalance);
  }

    // /**
    //  * @notice Cancels the stream and transfers the tokens back on a pro rata basis.
    //  * @dev Throws if the id does not point to a valid stream.
    //  *  Throws if the caller is not the sender or the recipient of the stream.
    //  *  Throws if there is a token transfer failure.
    //  * @param streamId The id of the stream to cancel.
    //  */
    // function cancelStream(uint256 streamId)
    //     external
    //     override
    //     nonReentrant
    //     streamExists(streamId)
    //     onlyUBI
    // {
    //   Types.Stream memory stream = streams[streamId];
    //   // Withdraw funds from the stream and delete it
    //   _withdrawFromStream(streamId);
    //   if(streams[streamId].isEntity) {
    //     // Delete the stream
    //     deleteStream(streamId);
    //   }

    //   emit CancelStream(streamId, stream.sender, stream.recipient);
    // }

    /**
     * @dev Set the max number of stream allowed per human.
     */
    function setMaxStreamsAllowed(uint256 newValue) external onlyUBI {
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
      if(!stream.isEntity) return 0;

        // If stream has not started, or it has been accrued all.
        if (block.timestamp < stream.startTime) return 0; // Stream not started
        if(stream.accruedSince >= stream.stopTime) return 0; // All stream withdrawn
        
      if(stream.accruedSince > 0) {	
        return Math.min(stream.stopTime, block.timestamp).sub(stream.accruedSince);
      } else {
        return Math.min(stream.stopTime, block.timestamp).sub(stream.startTime);
      }
    }

    /**
     * @dev gets the delegated accrued value.
     * This sums the accrued value of all active streams from the human's `accruedSince` to `block.timestamp`
     */
    function getDelegatedAccruedValue(address _human) public override view returns (uint256) {
      uint256 delegatedAccruedValue;
      // Iterate on each stream id of the human and calculate the currently delegated accrued value
      for(uint256 i = 0; i < streamIdsOf[_human].length; i++) {
        uint256 streamId = streamIdsOf[_human][i];

        Types.Stream memory stream = streams[streamId];
        if(!stream.isEntity) continue; // Stream Exists
        if(!IProofOfHumanity(proofOfHumanity).isRegistered(stream.sender)) continue; // Sender is a registered human

        // Time delegated to the stream
        uint256 streamAccumulatedTime = accruedTime(streamId);
        if(streamAccumulatedTime == 0) continue;

        // Stream's total accrued value is the accumulated time * stream's ratePerSecond
        // Add the stream accrued value to the pending delegated balance
        delegatedAccruedValue += streamAccumulatedTime.mul(stream.ratePerSecond);
      }
      return delegatedAccruedValue;
    }

    /**
     * @notice Returns the available funds for the given stream id and address.
     * @dev Throws if the id does not point to a valid stream.
     * @param streamId The id of the stream for which to query the balance.
     */
    function balanceOfStream(uint256 streamId) public override view returns (uint256) {
        Types.Stream memory stream = streams[streamId];
        if(!stream.isEntity) return 0;

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
        address recipient,
        address sender,
        bool isEntity,
        uint256 accruedSince)
    {
      Types.Stream memory stream = streams[streamId];
      return (stream.ratePerSecond,
        stream.startTime,
        stream.stopTime,
        stream.recipient,
        stream.sender,
        stream.isEntity,
        stream.accruedSince);
        // sender = streams[streamId].sender;
        // recipient = streams[streamId].recipient;
        // startTime = streams[streamId].startTime;
        // stopTime = streams[streamId].stopTime;
        // streamAccruedSince = streams[streamId].accruedSince;
        // ratePerSecond = streams[streamId].ratePerSecond;
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

    function streamExists(uint256 streamId) public override view returns (bool) {
      return streams[streamId].isEntity;
    }


    function maxStreamsAllowed() external override view returns (uint256) {
      return _maxStreamsAllowed;
    }
}