const ubiMockService = {
    /**
     * Deploys a mock UBI contract with the specified poh contract
     * @param {*} signer 
     * @param {*} pohContract 
     * @returns 
     */
    deployMockUBI: async (signer, pohContract) => {
        console.log("Deploying mock UBI...");
        // Deploy mock UBI
        const mockUBI = await waffle.deployMockContract(
            signer,
            require("../../artifacts/contracts/UBI.sol/UBI.json").abi
        )
        
        ubiMockService.setPoh(mockUBI, pohContract);
        return mockUBI;
    },

    setPoh: (mockUBI, pohContract) => {
        mockUBI.mock.proofOfHumanity.returns(pohContract);
    }
}

module.exports = ubiMockService;