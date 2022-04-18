const logReader = {
    /**
     * 
     * @param {*} events An array of events from a transaction receipt.
     */
    getCreateDelegationEvents(events) {
        const retVal = [];
        for(const event of events) {
            if(event.event === "CreateDelegation") retVal.push(event);
        }

        return retVal;
    }

   
}

module.exports = logReader;