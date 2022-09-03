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

	const increased_query = `
    update ct_ui_data set copyCount = copycount+$1 where did = $2 RETURNING *;
    `;

	let { increased = null, did = null } = JSON.parse(event.body);

	if (did === '' || did === null || isNaN(did)) {
		res = {
			statusCode: 400,
		};
	} else {
		try {
			if (increased === '' || increased === null || isNaN(increased)) {
				return {
					statusCode: 400,
				};
			}

			// increased_query
			const increased_res = await client.query(increased_query, [
				parseInt(increased),
				parseInt(did),
			]);

			// success
			if (increased_res.rowCount === 1) {
				return {
					statusCode: 200,
					body: JSON.stringify({
						first: parseInt(increased) === increased_res.rows[0].copycount,
						did: parseInt(increased_res.rows[0].did),
						copyCount: parseInt(increased_res.rows[0].copycount),
					}),
				};
			} else {
				return {
					statusCode: 400,
				};
			}
		} catch (e) {
			console.error(e);
		} finally {
			client.release();
		}
	}

	return res;
};
