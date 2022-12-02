const aws = require('aws-sdk');
const ses = new aws.SES({ region: process.env.AWS_SES_REGION });

exports.handler = async function (event) {
	const { name = null, email = null, content = null } = JSON.parse(event.body);

	const emailBody = `name: ${name} \n email: ${email} \n content: \n ${content}`;
	var params = {
		Destination: {
			ToAddresses: [process.env.ToAddresses],
		},
		Message: {
			Body: {
				Text: { Data: emailBody },
			},

			Subject: { Data: 'Contexty Report(' + email + ')' },
		},
		Source: process.env.Source,
	};
	const test = await ses.sendEmail(params).promise();

	const response = {
		statusCode: 200,
		body: JSON.stringify('SUCCESS'),
	};
	return response;
};
