#!/usr/bin/env node

var watch = require('node-watch');
var fs = require('fs');
var RJSON = require('relaxed-json');
var util = require('util');
var colors = require('colors');
var keychain = require('keychain');
var prompt = require('prompt');
var s3 = require('s3');

var content = '';
var settings = require('./package.json');
var jobs = [];
var scanInterval = 1000;
var configLocation = './s3-config.json';
var ignorePatterns = '';
var accessKey = '';
var secretKey = '';
var bucket = '';
var isMac = /^darwin/.test(process.platform);

var start = function() {

  console.log('Watching directory: ' + process.cwd());
  
  var client = s3.createClient({
    s3Options: {
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
    },
  });

  var uploadFile = function(localFullPath,remoteFullPath) {
    var params = {
      localFile: localFullPath,
      s3Params: {
        Bucket: bucket,
        Key: remoteFullPath,
      }
    };
    var uploader = client.uploadFile(params);
    uploader.on('error', function(err) {
      console.error(colors.red("Unable to upload:" + remoteFullPath, err.stack));
    });
    uploader.on('end', function() {
      console.log(colors.green("Done uploading: " + remoteFullPath));
    });
  }

  // Initiate the watcher
  watch('.', function(filename) {
        
    // See if it matches 'ignore_regexes'
    var matches = false;
    for(var i=0;i<ignorePatterns.length;i++) {
      var res = filename.match(ignorePatterns[i]);
      if(res) {
        matches = true;
        break;
      }
    }

    // Upload if it doesn't match the ignorePatterns
    if(!matches) {

      console.log('Change detected: ' + colors.magenta(filename));

      var exists = fs.existsSync('./' + filename);
      var destination = filename;
      
      if(exists) {
        console.log('Uploading to -> ' + destination);
        uploadFile(filename,filename);     
      } else {
        console.log('Delete detected on ' + filename + '. Deleting server file -> ' + destination);
        // TODO: DELETE
      }

    }

  });
}

var writeConfig = function(obj) {
  fs.writeFileSync('./s3-config.json',JSON.stringify(obj,null,4),{ encoding: 'utf8'});
}

// Clear console screen
util.print("\u001b[2J\u001b[0;0H");

console.log(colors.magenta('S3 directory watcher v' + settings.version));

// Try to read sftp-config.json file
if(fs.existsSync(configLocation)) {
  content = fs.readFileSync(configLocation,'utf-8');
  // Try to parse sftp-config.json file
  try{
    var config = RJSON.parse(content);
    accessKey = config.accessKey;
    secretKey = config.secretKey;
    bucket = config.bucket;
   
    // If password is set in config file (Like in Sublime) then use that
    if(config.secretKey) {
      secretKey = config.secretKey;
      start();
    // Otherwise on Mac check the keychain for the password
    } else if(isMac) {
      var serviceName = 's3-sync-' + bucket + '-' + accessKey;
      keychain.getPassword({ account: 'foo', service: serviceName }, function(err, pass) {
        accessKey = pass;
        start();
        // Prints: Password is baz
      });
    } else {
      console.log(colors.red('Error: Unable to retrieve access key from s3-config.json or keychain!'));
      process.exit();
    }
    
  } catch(e) {
    console.log(colors.red('Error: Unable to parse s3-config.json!'));
    process.exit();
  }
} else {
  console.log('No s3-config.json found. Manually create file');
  prompt.start({
    'message': 'Please enter',
  });

  var schema = {
    properties: {
      accessKey: {
        description: "Access key",
        required: true
      },
      secretKey: {
        description: "Secret key",
        required: true,
        hidden: true
      },
      bucket: {
        description: "Bucket",
        required: true
      }
    }
  };

  prompt.get(schema, function (err, result) {
   
    var obj = {
      accessKey: result.accessKey,
      secretKey: result.secretKey,
      bucket: result.bucket
    }

    accessKey = result.accessKey;
    secretKey = result.secretKey;
    bucket = result.bucket;
    
    // If it's OSX: Set password in the kechain stead of the file
    if(isMac) {
      var serviceName = 's3-sync-' + bucket + '-' + accessKey;
      console.log('Storing password in keychain under key: ' + serviceName);
      keychain.setPassword({ account: 'foo', service: serviceName, password: secretKey }, function(err) {
        if(err) throw err;
        writeConfig(obj);
        start();
      });
    } else {
      obj["secretKey"] = result.secretKey;
      writeConfig(obj);
      start();
    }
  
  });

}
