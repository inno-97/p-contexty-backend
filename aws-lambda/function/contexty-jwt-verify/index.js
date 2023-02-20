const jwt = require('jsonwebtoken');

const SECRET_KEY = process.env.SECRET_KEY;

// function getCookiesFromHeader(headers) {
// 	if (headers === null || headers === undefined || headers.cookie === undefined) {
// 		return {};
// 	}

// 	// Split a cookie string in an array (Originally found http://stackoverflow.com/a/3409200/1427439)
// 	var list = {},
// 		rc = headers.cookie;

// 	rc &&
// 		rc.split(';').forEach(function (cookie) {
// 			var parts = cookie.split('=');
// 			var key = parts.shift().trim();
// 			var value = decodeURI(parts.join('='));
// 			if (key != '') {
// 				list[key] = value;
// 			}
// 		});

// 	return list;
// }

function verifyToken(token) {
	let decoded;
	try {
		decoded = jwt.verify(token, SECRET_KEY);
	} catch (err) {
		if (err.message === 'jwt expired') {
			console.log('expired token');
		} else if (err.message === 'invalid token') {
			console.log('invalid token');
		} else {
			console.log('verify token error');
		}

		return null;
	}
	return decoded;
}

exports.handler = async (event) => {
	// const cookies = getCookiesFromHeader(event.headers);

	let response = {
		isAuthorized: false,
	};

	const jwt_decode = verifyToken(event.headers.authorization);

	if (jwt_decode !== null) {
		response = {
			isAuthorized: true,
			context: {
				uuid: jwt_decode.uuid,
				auth: jwt_decode.auth,
			},
		};
	}

	return response;
};
