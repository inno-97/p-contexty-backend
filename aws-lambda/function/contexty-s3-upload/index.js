const AWS = require('aws-sdk');
const bluebird = require('bluebird');
const multipart = require('parse-multipart');

AWS.config.update({
	region: 'ap-northeast-2',
});

const s3 = new AWS.S3();

const rootPath = 'image/ui-data/';

exports.handler = async function (event, context) {
	const result = [];

	const boundary = multipart.getBoundary(event.headers['content-type']);
	const parts = multipart.Parse(Buffer.from(event.body, 'base64'), boundary);

	const files = getFiles(parts);
	return bluebird
		.map(files, async (file) => {
			return await upload(file).then(
				(data) => {
					result.push(data.key.replace(rootPath, ''));
				},
				(err) => {
					console.log(`s3 upload err => ${err}`);
				}
			);
		})
		.then((_) => {
			return context.succeed(result);
		});
};

const getFiles = function (parts) {
	const files = [];
	parts.forEach((part) => {
		const buffer = part.data;
		const fileFullName = decodeURIComponent(rootPath + part.filename);

		const params = {
			Bucket: 'contexty-s3',
			Key: fileFullName,
			Body: buffer,
		};

		files.push(params);
	});
	return files;
};

const upload = function (file) {
	return s3.upload(file).promise();
};
