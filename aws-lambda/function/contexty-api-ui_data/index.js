const pg = require('pg');

const pool = new pg.Pool({
	user: process.env.DB_USER,
	host: process.env.DB_HOST,
	database: process.env.DB_DATABASE,
	password: process.env.DB_PASSWORD,
	port: process.env.DB_PORT,
});

function getTags(db_json) {
	const tags = { category: {}, service: {}, events: [] };

	for (let i = 0; i < db_json.length; i++) {
		const tagType = db_json[i].type;

		const data = {
			id: db_json[i].tid,
			name: db_json[i].name,
		};

		if (Array.isArray(tags[tagType + 's'])) {
			tags[tagType + 's'].push(data);
		} else {
			tags[tagType] = data;
		}
	}

	return tags;
}

exports.handler = async (event, context, callback) => {
	const { did = null } = event.pathParameters ?? {};

	let res = {
		statusCode: 500,
	};

	if (did === '' || did === null || isNaN(did)) {
		res = {
			statusCode: 400,
		};
	} else {
		const client = await pool.connect();

		const query = `
		select cud.did, cudt.text, cud.image, cud.copycount, cud.timestamp,
			(select array_to_json(array_agg(ct)) from ct_tag ct
			inner join ct_rel_data_tag crdt on crdt.did = $1 and ct.tid = crdt.tid)
		from ct_ui_data cud 
			inner join ct_ui_data_text cudt on cud.did = cudt.did
			where cud.did = $1;
		`;

		try {
			// select get data query
			const get_query_res = await client.query(query, [parseInt(did)]);

			const ui_data = get_query_res.rows[0];

			if (ui_data === undefined) {
				res = {
					statusCode: 204,
				};
				return res;
			}

			// TODO implement
			res = {
				statusCode: 200,
				body: JSON.stringify({
					id: ui_data.did,
					image: ui_data.image,
					copyCount: ui_data.copycount,
					text: ui_data.text,
					timestamp: ui_data.timestamp.getTime(),
					tags: getTags(ui_data.array_to_json),
				}),
			};
		} catch (e) {
			console.error(e);
		} finally {
			client.release();
		}
	}

	return res;
};
