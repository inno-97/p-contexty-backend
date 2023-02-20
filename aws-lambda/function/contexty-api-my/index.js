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

	const uuid = event.requestContext.authorizer.lambda.uuid;

	if (uuid === undefined) {
		return {
			statusCode: 403,
		};
	}

	const client = await pool.connect();

	const query = `
		select uuid, uid, name, links, auth, "order" from ct_profile cp 
		where uuid = $1
	`;

	try {
		// select get data query
		const get_query_res = await client.query(query, [uuid]);

		const profiles_data = get_query_res.rows[0];

		if (get_query_res.rowCount === 0) {
			return {
				statusCode: 204,
			};
		}

		// TODO implement
		res = {
			statusCode: 200,
			body: JSON.stringify(profiles_data),
		};
	} catch (e) {
		console.error(e);
	} finally {
		client.release();
	}

	return res;
};
