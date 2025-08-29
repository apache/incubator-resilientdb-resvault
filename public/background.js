/*
* Licensed to the Apache Software Foundation (ASF) under one
* or more contributor license agreements.  See the NOTICE file
* distributed with this work for additional information
* regarding copyright ownership.  The ASF licenses this file
* to you under the Apache License, Version 2.0 (the
* "License"); you may not use this file except in compliance
* with the License.  You may obtain a copy of the License at
*
*   http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing,
* software distributed under the License is distributed on an
* "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
* KIND, either express or implied.  See the License for the
* specific language governing permissions and limitations
* under the License.
*
*/


let faviconUrls = {};

// Helper functions
function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    bytes.forEach(b => (binary += String.fromCharCode(b)));
    return btoa(binary);
}

function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

function uint8ArrayToBase64(uint8Array) {
    return arrayBufferToBase64(uint8Array.buffer);
}

function base64ToUint8Array(base64) {
    const arrayBuffer = base64ToArrayBuffer(base64);
    return new Uint8Array(arrayBuffer);
}

async function encryptData(data, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(data);
    const encrypted = await crypto.subtle.encrypt(
        {
            name: 'AES-GCM',
            iv: iv,
        },
        key,
        encoded
    );

    // Convert encrypted data and iv to Base64 strings
    const ciphertextBase64 = arrayBufferToBase64(encrypted);
    const ivBase64 = uint8ArrayToBase64(iv);

    return { ciphertext: ciphertextBase64, iv: ivBase64 };
}

async function decryptData(ciphertextBase64, ivBase64, key) {
    const ciphertext = base64ToArrayBuffer(ciphertextBase64);
    const iv = base64ToUint8Array(ivBase64);

    const decrypted = await crypto.subtle.decrypt(
        {
            name: 'AES-GCM',
            iv: iv,
        },
        key,
        ciphertext
    );
    const dec = new TextDecoder();
    return dec.decode(decrypted);
}

// Function to get full hostname from URL
function getBaseDomain(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname;
    } catch (error) {
        console.error('Invalid URL:', error);
        return '';
    }
}

// Function to escape special characters in GraphQL strings (useful for text fields)
function escapeGraphQLString(str) {
    if (typeof str !== 'string') {
        return '';
    }
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Function to get the favicon URL when a tab is updated
function updateFaviconUrl(tabId, changeInfo, tab) {
    if (changeInfo.status === 'complete' && tab.url) {
        const domain = getBaseDomain(tab.url);
        if (domain && tab.favIconUrl) {
            faviconUrls[domain] = tab.favIconUrl;

            // Also store in chrome.storage.local
            chrome.storage.local.get(['faviconUrls'], (result) => {
                let storedFavicons = result.faviconUrls || {};
                storedFavicons[domain] = tab.favIconUrl;
                chrome.storage.local.set({ faviconUrls: storedFavicons });
            });
        }
    }
}

// Add the listener for tab updates
chrome.tabs.onUpdated.addListener(updateFaviconUrl);

// Function to generate UUID v4
function generateUUID() {
    // Public Domain/MIT
    return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
        (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)
    );
}

// KV service helper function
async function callKVService(url, configData) {
    try {
        let graphqlQuery = '';
        
        switch (configData.command) {
            case 'set_balance':
                // Use the correct GraphQL schema with PrepareAsset data format
                graphqlQuery = `mutation { 
                    postTransaction(
                        data: {
                            asset: "ResDB",
                            id: "${generateUUID()}",
                            amount: "${configData.balance || '0'}",
                            operation: "TRANSFER",
                            recipient: "${configData.address || '0x0000000000000000000000000000000000000000'}",
                            type: "CREATE"
                        }
                    ) { 
                        id 
                    } 
                }`;
                break;
            default:
                throw new Error(`Unknown KV command: ${configData.command}`);
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query: graphqlQuery }),
        });

        if (!response.ok) {
            throw new Error(`Network response was not ok: ${response.statusText}`);
        }

        const result = await response.json();
        
        if (result.data && result.data.postTransaction) {
            return { success: true, transactionId: result.data.postTransaction.id };
        }
        
        if (result.errors) {
            return { success: false, error: result.errors[0].message };
        }
        
        return { success: true, data: result };
    } catch (error) {
        console.error('Error calling KV service:', error);
        throw error;
    }
}

// Contract service helper functions
async function callContractService(url, configData) {
    try {
        // Convert JSON commands to GraphQL mutations
        let graphqlQuery = '';
        
        switch (configData.command) {
            case 'create_account':
                graphqlQuery = `mutation { createAccount(config: "/opt/resilientdb/service/tools/config/interface/service.config") }`;
                break;
            case 'set_balance':
                graphqlQuery = `mutation { 
                    setBalance(
                        config: "/opt/resilientdb/service/tools/config/interface/service.config",
                        address: "${configData.address}",
                        balance: "${configData.balance}"
                    )
                }`;
                break;
            case 'deploy':
                graphqlQuery = `mutation { 
                    deployContract(
                        config: "/opt/resilientdb/service/tools/config/interface/service.config",
                        contract: "${configData.contract_path || 'contract.json'}", 
                        name: "${configData.contract_name}", 
                        arguments: "${configData.init_params || ''}", 
                        owner: "${configData.owner_address}"
                    ) { 
                        ownerAddress
                        contractAddress 
                        contractName
                    } 
                }`;
                break;
            case 'execute':
                graphqlQuery = `mutation { 
                    executeContract(
                        config: "/opt/resilientdb/service/tools/config/interface/service.config",
                        sender: "${configData.caller_address}", 
                        contract: "${configData.contract_address}", 
                        functionName: "${configData.func_name}", 
                        arguments: "${configData.params || ''}"
                    ) 
                }`;
                break;
            default:
                throw new Error(`Unknown command: ${configData.command}`);
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query: graphqlQuery }),
        });

        if (!response.ok) {
            if (response.status === 502) {
                throw new Error('Contract service is currently unavailable. Please try again later or use local development.');
            }
            throw new Error(`Network response was not ok: ${response.statusText}`);
        }

        const result = await response.json();
        
        // Convert GraphQL response to expected format
        if (result.data) {
            const data = result.data;
            if (data.createAccount) {
                return { success: true, accountAddress: data.createAccount };
            } else if (data.setBalance) {
                return { success: true, result: data.setBalance };
            } else if (data.deployContract) {
                return { 
                    success: true, 
                    contractAddress: data.deployContract.contractAddress,
                    ownerAddress: data.deployContract.ownerAddress,
                    contractName: data.deployContract.contractName
                };
            } else if (data.executeContract) {
                return { success: true, result: data.executeContract };
            }
        }
        
        if (result.errors) {
            return { success: false, error: result.errors[0].message };
        }
        
        return { success: true, data: result };
    } catch (error) {
        console.error('Error calling contract service:', error);
        throw error;
    }
}

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.action === 'storeKeys') {
        (async function () {
            try {
                // Generate new key material and encrypt the new keys
                const keyMaterial = await crypto.subtle.generateKey(
                    { name: 'AES-GCM', length: 256 },
                    true,
                    ['encrypt', 'decrypt']
                );

                const encryptedPublicKey = await encryptData(request.publicKey, keyMaterial);
                const encryptedPrivateKey = await encryptData(request.privateKey, keyMaterial);
                const encryptedUrl = await encryptData(request.url, keyMaterial);

                // Export the key material to JWK format
                const exportedKey = await crypto.subtle.exportKey('jwk', keyMaterial);

                // Store the encrypted keys per domain and net
                chrome.storage.local.get(['keys', 'connectedNets'], (result) => {
                    let keys = result.keys || {};
                    let connectedNets = result.connectedNets || {};

                    if (!keys[request.domain]) {
                        keys[request.domain] = {};
                    }

                    keys[request.domain][request.net] = {
                        publicKey: encryptedPublicKey,
                        privateKey: encryptedPrivateKey,
                        url: encryptedUrl,
                        exportedKey: exportedKey, // Store the exported key
                    };

                    connectedNets[request.domain] = request.net;

                    console.log('Storing keys for domain:', request.domain);
                    console.log('Storing net:', request.net);
                    console.log('ConnectedNets after storing:', connectedNets);

                    chrome.storage.local.set({ keys, connectedNets }, () => {
                        console.log('Keys stored for domain:', request.domain, 'and net:', request.net);
                        sendResponse({ success: true });
                    });
                });
            } catch (error) {
                console.error('Error in storeKeys:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();

        return true; // Keep the message channel open for async sendResponse
    } else if (request.action === 'disconnectKeys') {
        (async function () {
            // Remove the keys for the domain and net
            chrome.storage.local.get(['keys', 'connectedNets'], (result) => {
                let keys = result.keys || {};
                let connectedNets = result.connectedNets || {};
                if (keys[request.domain] && keys[request.domain][request.net]) {
                    delete keys[request.domain][request.net];
                    if (Object.keys(keys[request.domain]).length === 0) {
                        delete keys[request.domain];
                    }
                    if (connectedNets[request.domain] === request.net) {
                        delete connectedNets[request.domain];
                    }
                    chrome.storage.local.set({ keys, connectedNets }, () => {
                        console.log('Keys disconnected for domain:', request.domain, 'and net:', request.net);
                        console.log('ConnectedNets after disconnecting:', connectedNets);
                        sendResponse({ success: true });
                    });
                } else {
                    sendResponse({ success: false, error: 'No keys found to disconnect' });
                }
            });
        })();

        return true; // Keep the message channel open for async sendResponse
    } else if (request.action === 'requestData') {
        (async function () {
            chrome.storage.local.get(['keys', 'faviconUrls'], async function (result) {
                const keys = result.keys || {};
                const storedFavicons = result.faviconUrls || {};
                const faviconUrlForDomain = storedFavicons[request.domain] || '';

                if (keys[request.domain] && keys[request.domain][request.net]) {
                    const { publicKey, privateKey, url, exportedKey } = keys[request.domain][request.net];

                    try {
                        // Import the key material from JWK format
                        const keyMaterial = await crypto.subtle.importKey(
                            'jwk',
                            exportedKey,
                            { name: 'AES-GCM' },
                            true,
                            ['encrypt', 'decrypt']
                        );

                        const decryptedPublicKey = await decryptData(publicKey.ciphertext, publicKey.iv, keyMaterial);
                        const decryptedPrivateKey = await decryptData(privateKey.ciphertext, privateKey.iv, keyMaterial);
                        const decryptedUrl = await decryptData(url.ciphertext, url.iv, keyMaterial);

                        sendResponse({
                            publicKey: decryptedPublicKey,
                            privateKey: decryptedPrivateKey,
                            url: decryptedUrl,
                            faviconUrl: faviconUrlForDomain,
                        });
                    } catch (error) {
                        console.error('Error decrypting data:', error);
                        sendResponse({ error: 'Failed to decrypt data', faviconUrl: faviconUrlForDomain });
                    }
                } else {
                    sendResponse({ error: 'No keys found for domain and net', faviconUrl: faviconUrlForDomain });
                }
            });
        })();

        return true; // Keep the message channel open for async sendResponse
    } else if (request.action === 'getConnectedNet') {
        (async function () {
            chrome.storage.local.get(['connectedNets'], function (result) {
                const connectedNets = result.connectedNets || {};
                const net = connectedNets[request.domain];
                if (net) {
                    sendResponse({ net: net });
                } else {
                    sendResponse({ error: 'No connected net for domain' });
                }
            });
        })();

        return true; // Keep the message channel open for async sendResponse
    }

    // ------------------------------------------------
    // Updated: Using unified contract service for KV operations
    // ------------------------------------------------

    else if (request.action === 'submitTransactionFromDashboard') {
        (async function () {
            // Retrieve the necessary data
            const transactionData = request.transactionData;
            const domain = request.domain;
            const net = request.net;

            // Validate transactionData
            if (!transactionData || !transactionData.asset || !transactionData.recipientAddress || !transactionData.amount) {
                sendResponse({ success: false, error: 'Invalid transaction data.' });
                return;
            }

            // Retrieve the signer's keys and URL from storage
            chrome.storage.local.get(['keys', 'connectedNets'], async function (result) {
                const keys = result.keys || {};
                const connectedNets = result.connectedNets || {};

                if (!connectedNets[domain] || connectedNets[domain] !== net) {
                    sendResponse({ success: false, error: 'Not connected to the specified net for this domain.' });
                    return;
                }

                if (!keys[domain] || !keys[domain][net]) {
                    sendResponse({ success: false, error: 'Keys not found for the specified domain and net.' });
                    return;
                }

                const { url, exportedKey } = keys[domain][net];

                try {
                    // Import the key material from JWK format
                    const keyMaterial = await crypto.subtle.importKey(
                        'jwk',
                        exportedKey,
                        { name: 'AES-GCM' },
                        true,
                        ['encrypt', 'decrypt']
                    );

                    const decryptedUrl = await decryptData(url.ciphertext, url.iv, keyMaterial);

                    // Use KV service for balance operations
                    const configData = {
                        command: "set_balance",
                        address: transactionData.recipientAddress,
                        balance: transactionData.amount.toString()
                    };

                    // Use KV endpoint for balance operations
                    const kvUrl = decryptedUrl.replace('8400', '8000'); // Contract endpoint to KV endpoint
                    const result = await callKVService(kvUrl, configData);
                    
                    if (result.success) {
                        sendResponse({ success: true, data: { postTransaction: { id: result.transactionId || generateUUID() } } });
                    } else {
                        sendResponse({ success: false, error: result.error || 'Transaction failed' });
                    }
                } catch (error) {
                    console.error('Error submitting transaction:', error);
                    sendResponse({ success: false, error: error.message });
                }
            });
        })();

        return true; // Keep the message channel open for async sendResponse
    }

    else if (request.action === 'submitTransaction') {
        (async function () {
            console.log('Handling submitTransaction action');
            console.log('Sender:', sender);
            let senderUrl = null;
            if (sender.tab && sender.tab.url) {
                senderUrl = sender.tab.url;
            } else if (sender.url) {
                senderUrl = sender.url;
            } else if (sender.origin) {
                senderUrl = sender.origin;
            } else {
                console.error('Sender URL is undefined');
                sendResponse({ success: false, error: 'Cannot determine sender URL' });
                return;
            }
            console.log('Sender URL:', senderUrl);

            const domain = getBaseDomain(senderUrl);
            console.log('Domain:', domain);

            chrome.storage.local.get(['keys', 'connectedNets'], async function (result) {
                const keys = result.keys || {};
                const connectedNets = result.connectedNets || {};
                console.log('ConnectedNets:', connectedNets);
                const net = connectedNets[domain];
                console.log('Net for domain:', domain, 'is', net);

                if (keys[domain] && keys[domain][net]) {
                    const { url, exportedKey } = keys[domain][net];

                    try {
                        // Import the key material from JWK format
                        const keyMaterial = await crypto.subtle.importKey(
                            'jwk',
                            exportedKey,
                            { name: 'AES-GCM' },
                            true,
                            ['encrypt', 'decrypt']
                        );

                        const decryptedUrl = await decryptData(url.ciphertext, url.iv, keyMaterial);

                        // Check if required fields are defined
                        if (!request.recipient) {
                            console.error('Missing required fields for transaction submission');
                            sendResponse({
                                success: false,
                                error: 'Missing required fields for transaction',
                            });
                            return;
                        }

                        // Use KV service for balance operations
                        const configData = {
                            command: "set_balance",
                            address: request.recipient,
                            balance: request.amount.toString()
                        };

                        // Use KV endpoint for balance operations
                        const kvUrl = decryptedUrl.replace('8400', '8000'); // Contract endpoint to KV endpoint
                        const result = await callKVService(kvUrl, configData);
                        
                        if (result.success) {
                            sendResponse({ success: true, data: { postTransaction: { id: result.transactionId || generateUUID() } } });
                        } else {
                            sendResponse({ success: false, error: result.error || 'Transaction failed' });
                        }
                    } catch (error) {
                        console.error('Error submitting transaction:', error);
                        sendResponse({ success: false, error: error.message });
                    }
                } else {
                    console.error('No keys found for domain:', domain, 'and net:', net);
                    console.log('Available keys:', keys);
                    sendResponse({ error: 'No keys found for domain and net' });
                }
            });
        })();

        return true; // Keep the message channel open for async sendResponse
    }

    else if (request.action === 'submitLoginTransaction') {
        (async function () {
            console.log('Handling submitLoginTransaction action');
            console.log('Sender:', sender);
            let senderUrl = null;
            if (sender.tab && sender.tab.url) {
                senderUrl = sender.tab.url;
            } else if (sender.url) {
                senderUrl = sender.url;
            } else if (sender.origin) {
                senderUrl = sender.origin;
            } else {
                console.error('Sender URL is undefined');
                sendResponse({ success: false, error: 'Cannot determine sender URL' });
                return;
            }
            console.log('Sender URL:', senderUrl);

            const domain = getBaseDomain(senderUrl);
            console.log('Domain:', domain);

            chrome.storage.local.get(['keys', 'connectedNets'], async function (result) {
                const keys = result.keys || {};
                const connectedNets = result.connectedNets || {};
                console.log('ConnectedNets:', connectedNets);
                const net = connectedNets[domain];
                console.log('Net for domain:', domain, 'is', net);

                if (keys[domain] && keys[domain][net]) {
                    const { url, exportedKey } = keys[domain][net];

                    try {
                        // Import the key material from JWK format
                        const keyMaterial = await crypto.subtle.importKey(
                            'jwk',
                            exportedKey,
                            { name: 'AES-GCM' },
                            true,
                            ['encrypt', 'decrypt']
                        );

                        const decryptedUrl = await decryptData(url.ciphertext, url.iv, keyMaterial);

                        // Use KV service for login transaction
                        const configData = {
                            command: "set_balance",
                            address: request.ownerAddress || "0x0000000000000000000000000000000000000000",
                            balance: "1"
                        };

                        // Use KV endpoint for balance operations
                        const kvUrl = decryptedUrl.replace('8400', '8000'); // Contract endpoint to KV endpoint
                        const result = await callKVService(kvUrl, configData);
                        
                        if (result.success) {
                            sendResponse({ success: true, data: { postTransaction: { id: result.transactionId || generateUUID() } } });
                        } else {
                            sendResponse({ success: false, error: result.error || 'Login transaction failed' });
                        }
                    } catch (error) {
                        console.error('Error submitting login transaction:', error);
                        sendResponse({ success: false, error: error.message });
                    }
                } else {
                    console.error('No keys found for domain:', domain, 'and net:', net);
                    console.log('Available keys:', keys);
                    sendResponse({ error: 'No keys found for domain and net' });
                }
            });
        })();

        return true; // Keep the message channel open for async sendResponse
    }

    // Updated: Using unified contract service for contract deployment
    else if (request.action === 'deployContractChain') {
        (async function () {
            const domain = request.domain;
            const net = request.net;
            const ownerAddress = request.ownerAddress;
            const soliditySource = request.soliditySource;
            const deployConfig = request.deployConfig;

            // Retrieve the signer's keys and URL from storage
            chrome.storage.local.get(['keys', 'connectedNets'], async function (result) {
                const keys = result.keys || {};
                const connectedNets = result.connectedNets || {};

                if (!connectedNets[domain] || connectedNets[domain] !== net) {
                    sendResponse({ success: false, error: 'Not connected to the specified net for this domain.' });
                    return;
                }

                if (!keys[domain] || !keys[domain][net]) {
                    sendResponse({ success: false, error: 'Keys not found for the specified domain and net.' });
                    return;
                }

                const { url, exportedKey } = keys[domain][net];

                try {
                    // Import the key material from JWK format
                    const keyMaterial = await crypto.subtle.importKey(
                        'jwk',
                        exportedKey,
                        { name: 'AES-GCM' },
                        true,
                        ['encrypt', 'decrypt']
                    );

                    const decryptedUrl = await decryptData(url.ciphertext, url.iv, keyMaterial);

                    // Step 1: Create account for the owner address
                    const createAccountConfig = {
                        command: "create_account"
                    };

                    const createAccountResponse = await fetch(decryptedUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ query: `mutation { createAccount(config: "5 127.0.0.1 10005", type: "data") }` }),
                    });

                    const createAccountResult = await createAccountResponse.json();
                    if (createAccountResult.errors) {
                        sendResponse({
                            success: false,
                            error: 'Error creating account: ' + createAccountResult.errors[0].message,
                        });
                        return;
                    }

                    // Step 1.5: Use the created account address for deployment
                    const createdAccountAddress = createAccountResult.data.createAccount;
                    console.log('Using created account:', createdAccountAddress);

                    // Step 2: Deploy the contract using the new unified service
                    const { arguments: args, contract_name } = request.deployConfig;
                    
                    // Step 2: Compile the Solidity contract on the server
                    const escapedSoliditySource = soliditySource.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

                    const compileContractMutation = `
                    mutation {
                      compileContract(
                                source: "${escapedSoliditySource}",
                        type: "data"
                      )
                    }
                    `;

                    const compileContractResponse = await fetch(decryptedUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ query: compileContractMutation }),
                    });

                    if (!compileContractResponse.ok) {
                        throw new Error(`Network response was not ok: ${compileContractResponse.statusText}`);
                    }

                    const compileContractResult = await compileContractResponse.json();
                    if (compileContractResult.errors) {
                        console.error('GraphQL errors in compileContract:', compileContractResult.errors);
                        sendResponse({
                            success: false,
                            error: 'Error in compileContract mutation.',
                            errors: compileContractResult.errors,
                        });
                        return;
                    }

                    const contractFilename = compileContractResult.data.compileContract;
                    if (!contractFilename) {
                        sendResponse({
                            success: false,
                            error: 'Failed to compile contract.',
                        });
                        return;
                    }

                    // Step 3: Deploy the contract using the compiled filename
                    const escapedContractName = contract_name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                    const escapedArgs = args.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                    const escapedOwnerAddress = createdAccountAddress.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                    const escapedContractFilename = contractFilename.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                    
                    const deployContractMutation = `
                    mutation {
                      deployContract(
                                config: "5 127.0.0.1 10005",
                                contract: "${escapedContractFilename}",
                                name: "/tmp/${contractFilename.replace('.json', '.sol')}:${contract_name.split(':')[1] || contract_name}",
                                arguments: "${escapedArgs}",
                                owner: "${escapedOwnerAddress}",
                                type: "data"
                            ) {
                        ownerAddress
                        contractAddress
                        contractName
                      }
                    }
                    `;

                    const deployContractResponse = await fetch(decryptedUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ query: deployContractMutation }),
                    });

                    if (!deployContractResponse.ok) {
                        throw new Error(`Network response was not ok: ${deployContractResponse.statusText}`);
                    }

                    const deployContractResult = await deployContractResponse.json();
                    
                    // Debug logging to see what we actually receive
                    console.log('Deploy contract response:', deployContractResult);
                    
                    if (deployContractResult.errors) {
                        console.error('GraphQL errors in deployContract:', deployContractResult.errors);
                        sendResponse({
                            success: false,
                            error: 'Error in deployContract mutation: ' + deployContractResult.errors[0].message,
                        });
                        return;
                    }

                    // Check for different possible response formats
                    if (deployContractResult.data && deployContractResult.data.deployContract) {
                        const deployData = deployContractResult.data.deployContract;
                        
                        // Handle both object and string responses
                        if (typeof deployData === 'string') {
                            // Parse string response that might contain deployment info
                            sendResponse({ 
                                success: true, 
                                contractAddress: "deployment_successful",
                                ownerAddress: ownerAddress,
                                contractName: contract_name,
                                rawResponse: deployData
                            });
                        } else if (deployData.contractAddress) {
                            sendResponse({ 
                                success: true, 
                                contractAddress: deployData.contractAddress,
                                ownerAddress: deployData.ownerAddress,
                                contractName: deployData.contractName
                            });
                        } else {
                            // Deployment succeeded but no specific contract address format
                            sendResponse({ 
                                success: true, 
                                contractAddress: "deployed_successfully",
                                ownerAddress: ownerAddress,
                                contractName: contract_name,
                                rawResponse: deployData
                            });
                        }
                    } else {
                        console.log('Unexpected response format:', deployContractResult);
                        sendResponse({
                            success: false,
                            error: 'Failed to parse deployment output.',
                        });
                    }

                } catch (error) {
                    console.error('Error deploying contract chain:', error);
                    sendResponse({ success: false, error: error.message });
                }
            });
        })();

        return true; // Keep the message channel open for async sendResponse
    }

    // Updated: Using unified contract service for contract execution
    else if (request.action === 'executeContractFunction') {
        (async function () {
            const domain = request.domain;
            const net = request.net;
            const ownerAddress = request.ownerAddress;
            const contractAddress = request.contractAddress;
            const functionName = request.functionName;
            const functionArgs = request.functionArgs;

            // Retrieve the signer's keys and URL from storage
            chrome.storage.local.get(['keys', 'connectedNets'], async function (result) {
                const keys = result.keys || {};
                const connectedNets = result.connectedNets || {};

                if (!connectedNets[domain] || connectedNets[domain] !== net) {
                    sendResponse({ success: false, error: 'Not connected to the specified net for this domain.' });
                    return;
                }

                if (!keys[domain] || !keys[domain][net]) {
                    sendResponse({ success: false, error: 'Keys not found for the specified domain and net.' });
                    return;
                }

                const { url, exportedKey } = keys[domain][net];

                try {
                    // Import the key material from JWK format
                    const keyMaterial = await crypto.subtle.importKey(
                        'jwk',
                        exportedKey,
                        { name: 'AES-GCM' },
                        true,
                        ['encrypt', 'decrypt']
                    );

                    const decryptedUrl = await decryptData(url.ciphertext, url.iv, keyMaterial);

                    // Use unified contract service for contract execution
                    const configData = {
                        command: "execute",
                        contract_address: contractAddress,
                        caller_address: ownerAddress,
                        func_name: functionName,
                        params: functionArgs
                    };

                    const result = await callContractService(decryptedUrl, configData);
                    
                    if (result.success) {
                        sendResponse({ 
                            success: true, 
                            transactionId: result.transactionId || generateUUID(),
                            result: result.result,
                            message: 'Contract function executed successfully.'
                        });
                    } else {
                        sendResponse({
                            success: false,
                            error: 'Failed to execute contract function: ' + (result.error || 'Unknown error'),
                        });
                    }

                } catch (error) {
                    console.error('Error executing contract function:', error);
                    sendResponse({ success: false, error: error.message });
                }
            });
        })();

        return true; // Keep the message channel open for async sendResponse
    }
});
