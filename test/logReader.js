const logReader = {
    /**
     * 
     * @param {*} events An array of events from a transaction receipt.
     */

     getCreateFlowEvents(events) {
        const retVal = [];
        for(const event of events) {
            if(event.event === "CreateFlow") retVal.push(event);
        }

        return retVal;
    },
    getCreateStreamEvents(events) {
        const retVal = [];
        for(const event of events) {
            if(event.event === "CreateStream") retVal.push(event);
        }

        return retVal;
    }

   
}

module.exports = logReader;