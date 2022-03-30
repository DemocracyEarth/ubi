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
import "./interfaces/IFUBI.sol";
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
  function getUbiOutflow(address _human) external view returns(uint256);
  function onFlowTransfer(address _oldOwner, address _newOwner, uint256 ratePerSecond) external;
}
/**
 * @title Universal Basic Income
 * @dev UBI is an ERC20 compatible token that is connected to a Proof of Humanity registry
 *
 * Tokens are issued and drip over time for every verified submission on a Proof of Humanity registry.
 * The accrued tokens are updated directly on every wallet using the `balanceOf` function.
 * The tokens get effectively minted and persisted in memory when someone interacts with the contract doing a `transfer` or `burn`.
 */
contract fUBI is ERC721, IFUBI, ReentrancyGuard  {

  using SafeMath for uint256;

  address public ubi;
  address public sUBI;
  address public governor;

  /// @dev The Proof Of Humanity registry to reference.
  address public proofOfHumanity;
  
  /// @dev The last token ID issued.
  uint256 public lastTokenId = 0;

  /// @dev Maximum number of flows allowed.
  uint256 private _maxFlowsAllowed;

  /// @dev The Flow objects identifiable by their unsigned integer ids.
  mapping(uint256 => Types.Flow) private Flows;

  /// @dev A mapping containing UNORDERED lists of the Flow ids of each sender.
  /// @notice This does not guarantee to contain valid Flows. Some may be ended (not withdrawn).
  mapping (address => uint256[]) public FlowIdsOf;

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

  constructor(address pUBI, address pGovernor, uint256 pMaxFlowsAllowed,string memory pName, string memory pSymbol) ERC721(pName, pSymbol) ReentrancyGuard() {
      _maxFlowsAllowed = pMaxFlowsAllowed;
      ubi = pUBI;
      proofOfHumanity = IUBI(ubi).getProofOfHumanity();
      governor = pGovernor;
  }

  /**
    * @notice Creates a new Flow funded by `msg.sender` and sent to `recipient`.
    * @dev Throws if the recipient is the zero address, the contract itself or the caller.
    *  Throws if the start time is before `block.timestamp`.
    *  Throws if the stop time is before the start time.
    *  Throws if the duration calculation has a math error.
    *  Throws if the rate calculation has a math error.
    *  Throws if the next Flow id calculation has a math error.
    *  Throws if the contract is not allowed to transfer enough tokens.
    *  Throws if there is a token transfer failure.
    * @param recipient The address towards which the Flow is minted to
    * @param ubiPerSecond The amount of UBI to be Flowed every second. MUST be <= accruedPerSecond
    * @return The uint256 id of the newly created Flow.
    */
  function mintFlow(address sender, address recipient, uint256 ubiPerSecond)
      public
      override
      nonReentrant
      onlyUBI
      returns (uint256)
  {
      require(recipient != address(0), "Flow to the zero address");
      require(recipient != address(this), "Flow to the contract itself");
      require(recipient != sender, "Flow to the caller");
      require(ubiPerSecond > 0, "UBI per second is zero");
      require(ubiPerSecond <= IUBI(ubi).getAccruedPerSecond(), "Cannot delegate a value higher than accruedPerSecond");
      require(ubiPerSecond <= (IUBI(ubi).getAccruedPerSecond()).sub(ISUBI(sUBI).getDelegatedValue(sender))
      .sub(IUBI(ubi).getUbiOutflow(sender)), "Delegated value exceeds available balance for the given Flow");
      lastTokenId += 1;

      // Check that we are not exceeding the max allowed.
      require(FlowIdsOf[sender].length + 1 <= _maxFlowsAllowed, "max flows exceeded");

      // Create the Flow
      Flows[lastTokenId] = Types.Flow({
        // how many UBI to delegate per second.
        ratePerSecond: ubiPerSecond,
        // Starts with 0. Accumulates as time passes.
        isActive: true,
        sender: sender,
        startTime: block.timestamp
      });

      FlowIdsOf[sender].push(lastTokenId);

      _safeMint(recipient, lastTokenId);

      emit CreateFlow(sender, lastTokenId, ubiPerSecond, block.timestamp);
      return lastTokenId;
  } 

  function setUBI(address pUBI) public onlyUBI {
    ubi = pUBI;
  }

  /// @dev Deletes the given Flow from related variables
  function deleteFlow(uint256 FlowId) internal {
    Types.Flow memory Flow = Flows[FlowId];

    // DELETE FROM FlowIdsOf
    // Get the index of the last item
    uint256 indexOfLastItem = FlowIdsOf[Flow.sender].length - 1;
    
    //WE WERE THINKING ABOUT GETTING RID OF THIS FOR
    //BY USING ENUMERABLE SET (OPENZEPPELIN) THAT'S WHY
    // WE DON'T HAVE _maxFlowsAllowed
    
    for(uint256 i = 0; i < FlowIdsOf[Flow.sender].length; i++) {
      // If Flow is found
      if(FlowIdsOf[Flow.sender][i] == FlowId) {
        // If it's not the last element on the array
        if(i < indexOfLastItem) {
          // Replace the found Flow with the last element on the array
          FlowIdsOf[Flow.sender][i] = FlowIdsOf[Flow.sender][indexOfLastItem];
        }
        // Delete the last element on the list
        FlowIdsOf[Flow.sender].pop();
        break;
      }
    }
    
    // Disable the Flow
    Flows[FlowId].isActive = false;
  }
  
  function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId
    ) internal override {
        Types.Flow memory flow = Flows[tokenId];
        if(flow.isActive && from != address(0)){
        IUBI(ubi).onFlowTransfer(from, to, flow.ratePerSecond);
        }
    }


    /// @dev Callback for when UBI contract has cancelled a Flow.
    function onCancelFlow(uint256 FlowId) public override onlyUBI {
      Types.Flow memory Flow = Flows[FlowId];
      deleteFlow(FlowId);
      emit CancelFlow(FlowId, Flow.sender, ownerOf(FlowId));
    }

    /**
     * @dev Set the max number of flows allowed per human.
     */
    function setMaxFlowsAllowed(uint256 newValue) external onlyByGovernor {
      _maxFlowsAllowed = newValue;
    }


    /**
     * @dev gets the delegated value.
     * This sums the  value of all active Flows from the human.
     */
    function getDelegatedValue(address _human) public override view returns (uint256) {
      IUBI(ubi).getUbiOutflow(_human);
    }



    /**
     * @notice Returns the Flow with all its properties.
     * @dev Throws if the id does not point to a valid Flow.
     * @param FlowId The id of the Flow to query.
     */
    function getFlow(uint256 FlowId)
        external
        override
        view
        returns (uint256 ratePerSecond, // The rate of UBI to drip to this Flow from the current accrued value
        uint256 startTime,
        address sender,
        bool isActive
        )
    {
      Types.Flow memory Flow = Flows[FlowId];
      return (Flow.ratePerSecond,
        Flow.startTime,
        Flow.sender,
        Flow.isActive
        );
    }

    function getFlowsCount(address _human) public view returns (uint256) {
      return FlowIdsOf[_human].length;
    }

    function getFlowsOf(address _human) public override view returns (uint256[] memory) {
      return FlowIdsOf[_human];
    }

    function maxFlowsAllowed() external override view returns (uint256) {
      return _maxFlowsAllowed;
    }


    function tokenURI(uint256 pTokenId) public view override returns(string memory) {
      return "";
      // Types.Flow storage Flow = Flows[pTokenId];
      // string memory metadataHeader = bytes(
      //   abi.encodePacked('{"description":"Flowed UBI from',string(Flow.sender),'",', 
      //     //"external_url": "https://openseacreatures.io/3", 
      //     //"image": "https://storage.googleapis.com/opensea-prod.appspot.com/puffs/3.png", 
      //     '"name": "Flowing UBI",',
      //     '"attributes": [',
      //     '{"trait_type": "Sender", "value": "', Flow.sender, '"},',
      //     '{"trait_type": "Start", "value": "', Flow.startTime, '"},',
      //     '{"trait_type": "Rate per second", "value": "', Flow.ratePerSecond, '"},');

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

    function setSUBI(address _subi) public onlyByGovernor {
      sUBI = _subi;
    } 
}
