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

	const client = await pool.connect();

	const query = `
		select uuid, name, links from ct_profile cp 
		order by "order";
	`;

	try {
		// select get data query
		const get_query_res = await client.query(query);

		const profiles_data = get_query_res.rows;

		if (profiles_data === undefined) {
			res = {
				statusCode: 204,
			};
			return res;
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
