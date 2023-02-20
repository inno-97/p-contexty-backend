const jwt = require('jsonwebtoken');
const pg = require('pg');

const pool = new pg.Pool({
	user: process.env.DB_USER,
	host: process.env.DB_HOST,
	database: process.env.DB_DATABASE,
	password: process.env.DB_PASSWORD,
	port: process.env.DB_PORT,
});

exports.handler = async (event, context, callback) => {
	let res = {
		statusCode: 500,
	};

	const signin_query = `
    select uuid, uid, name, auth from ct_profile cp 
    where uid = $1 and decrypt( "password", '${process.env.ENCRYPT}', 'aes') = $2
    `;

	let { uid = null, password = null } = JSON.parse(event.body);

	if (uid === null || password === null) {
		return {
			statusCode: 401,
		};
	}

	const client = await pool.connect();

	try {
		const signin_res = await client.query(signin_query, [uid, password]);

		if (signin_res.rowCount === 0) {
			return {
				statusCode: 401,
			};
		} else {
			const account = signin_res.rows[0];
			const token = jwt.sign(
				{
					type: 'JWT',
					uuid: account.uuid,
					auth: account.auth,
				},
				process.env.SECRET_KEY,
				{
					expiresIn: '7d',
					issuer: 'contexty.kr',
				}
			);

			var date = new Date();

			// Get Unix milliseconds at current time plus 365 days
			date.setTime(+date + 7 * 86400000); //24 \* 60 \* 60 \* 100
			var cookieVal = token; // Generate a random cookie string

			var cookieString =
				'ctt_jwt=' +
				cookieVal +
				'; Domain=contexty.kr; Expires=' +
				date.toGMTString() +
				'; SameSite=None; Secure;';

			res = {
				statusCode: 200,
				body: 'success',
				headers: {
					'Access-Control-Allow-Origin': 'https://contexty.kr',
					'Access-Control-Allow-Credentials': true,
					Authorization: token,
					'Set-Cookie': cookieString,
				},
			};
		}
	} catch (e) {
		console.error(e);
	} finally {
		client.release();
	}

	return res;
};
