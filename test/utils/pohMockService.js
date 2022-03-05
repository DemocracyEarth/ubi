const pohMockService = {
    /**
     * Deploys a Proof of Humanity mock contract
     * @returns 
     */
    deployMock: async (signer) => {
        console.log("Deploying mock POH...");
        // Deploy MOCK POH
        mockProofOfHumanity = await waffle.deployMockContract(
            signer,
            require("../../artifacts/contracts/UBI.sol/IProofOfHumanity.json").abi
        )

        return mockProofOfHumanity;
    },

    /**
     * Mock the registered status of an address.
     * @param {*} address 
     * @param {*} isRegistered 
     * @returns 
     */
    setSubmissionIsRegistered: (mockProofOfHumanity, address, isRegistered) => {
        mockProofOfHumanity.mock.isRegistered
            .withArgs(address)
            .returns(isRegistered)
    },

    /**
     * Mock the submission info on a submission.
     * @param {*} submissionID 
     * @param {*} info 
     */
    setSubmissionInfo: (mockProofOfHumanity, submissionID, info) => {
        mockProofOfHumanity.mock.getSubmissionInfo
            .withArgs(submissionID)
            .returns({
                submissionTime: info.submissionTime
            });
    }
}

module.exports = pohMockService;