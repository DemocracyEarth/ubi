const ubiMockService = {
    /**
     * Deploys a mock UBI contract with the specified poh contract
     * @param {*} signer 
     * @param {*} pohContract 
     * @returns 
     */
    deployMockUBI: async (signer, pohContract) => {
        // Deploy mock UBI
        const mockUBI = await waffle.deployMockContract(
            signer,
            require("../../artifacts/contracts/UBI.sol/UBI.json").abi
        )
        
        ubiMockService.setPoh(mockUBI, pohContract);
        return mockUBI;
    },

    setPoh: (mockUBI, pohContract) => {
        mockUBI.mock.getProofOfHumanity.returns(pohContract.address);
    },

    setSUBI: (mockUBI, subiContract) => {
        mockUBI.mock.subi.return(subiContract.address);
    }
}

module.exports = ubiMockService;