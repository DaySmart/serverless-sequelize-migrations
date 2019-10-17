function getSecret(aws, secretName) {
    let params = {
        SecretId: secretName
    };
    return new Promise(function(resolve, reject) {
        aws.request('SecretsManager', 'getSecretValue', params).then(resp => {
            resolve(JSON.parse(resp.SecretString));
        })
    });
}

module.exports = {
    getSecret
}