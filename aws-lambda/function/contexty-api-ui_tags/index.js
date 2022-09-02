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

	const data = {};

	const client = await pool.connect();
	try {
		const query_res = await client.query(
			'select tid as id, type, name, icon from ct_tag order by type, name'
		);

		for (let i = 0; i < query_res.rows.length; i++) {
			const tag = query_res.rows[i];
			const tagClass = `${tag.type}s`;

			if (!data.hasOwnProperty(`${tag.type}s`)) {
				data[tagClass] = [];
			}

			data[tagClass].push({
				...tag,
				label: tag.name,
				value: tag.id,
			});
		}

		// TODO implement
		res = {
			statusCode: 200,
			body: JSON.stringify(data),
		};
	} catch (e) {
		console.error(e);
	} finally {
		client.release();
	}

	return res;
};
