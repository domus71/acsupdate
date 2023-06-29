require("dotenv").config({ path: "./config/.env" });
const axios = require("axios");
const knex = require("knex")({
  client: "mysql2",
  debug: false,
  connection: {
    host: process.env.DB_SERVER,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: "utf8",
  },
});

const acsRequest = async (order) => {
  try {
    const response = await axios.post(
      process.env.ACS_APIURL,
      {
        ACSAlias: "ACS_Trackingsummary",
        ACSInputParameters: {
          Company_ID: process.env.ACS_COMPANYID,
          Company_Password: process.env.ACS_COMPANYPASS,
          User_ID: process.env.ACS_USERNAME,
          User_Password: process.env.ACS_PASSWORD,
          Language: null,
          Voucher_No: order.or_postID,
        },
      },
      {
        headers: { AcsApiKey: process.env.ACS_APIKEY },
      }
    );
    return response.data.ACSOutputResponce.ACSTableOutput.Table_Data;
  } catch (err) {
    console.error(err);
  }
};

const tasRequest = async (order) => {
  const url = process.env.TAS_URL;

  try {
    const response = await axios({
      url: url + "/hermes_api/pegapi00/hello",
      method: "get",
    });
    const sid = response.data.data.sid;
    const tracking = await axios({
      url:
        url +
        "/hermes_api/courier/voucher_tracking?sid=" +
        sid +
        "&vouchercode[]=" +
        order.or_postID,
      method: "get",
    });
    return tracking.data.data;
  } catch (err) {
    console.error(err);
  }
};

const acsCODRequest = async (date) => {
  try {
    var dateString = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
      .toISOString()
      .split("T")[0];
    const response = await axios.post(
      process.env.ACS_APIURL,
      {
        ACSAlias: "ACS_COD_Beneficiary_Info",
        ACSInputParameters: {
          Company_ID: process.env.ACS_COMPANYID,
          Company_Password: process.env.ACS_COMPANYPASS,
          User_ID: process.env.ACS_USERNAME,
          User_Password: process.env.ACS_PASSWORD,
          User_locals: "GR",
          COD_Payment_Date: dateString,
        },
      },
      {
        headers: { AcsApiKey: process.env.ACS_APIKEY },
      }
    );
    return response.data.ACSOutputResponce.ACSTableOutput.Table_Data;
  } catch (err) {
    console.error(err);
  }
};

const checkAndupdate = async (acsResponse, paymentMethod) => {
  let pay_status = 0;
  let delivery_date = null;
  let delivery_consignee = null;
  try {
    const obj = acsResponse[0];
    if (obj.delivery_flag === 1) {
      pay_status =
        parseInt(paymentMethod) === 2 || parseInt(paymentMethod) === 6 ? 1 : 3;
      delivery_date = obj.delivery_date;
      delivery_consignee = obj.consignee;
    } else if (obj.returned_flag === 1) {
      pay_status = 2;
    }
    if (pay_status != 0) {
      await knex("app_orders").where("or_postID", obj.voucher_no).update({
        or_pay_status: pay_status,
        or_delivery_date: delivery_date,
        or_delivery_consignee: delivery_consignee,
      });
    }
  } catch (err) {
    console.error(err);
  }
};

const checkAndupdateTAS = async (tasResponse, paymentMethod) => {
  let pay_status = 0;
  let delivery_date = null;
  let delivery_consignee = null;
  try {
    const obj = tasResponse[0];
    if (obj.r18p014 === 'ΠΡΔ') {
      pay_status =
        parseInt(paymentMethod) === 2 || parseInt(paymentMethod) === 6 ? 1 : 3;
      delivery_date = obj.r18p117 + ' '+ obj.r18p118;
      delivery_consignee = obj.r18p119;
    } else if (obj.r18p014 === 'AKR') {
      pay_status = 2;
    }
    if (pay_status != 0) {
      await knex("app_orders").where("or_postID", obj.r18p01).update({
        or_pay_status: pay_status,
        or_delivery_date: delivery_date,
        or_delivery_consignee: delivery_consignee,
      });
    }
  } catch (err) {
    console.error(err);
  }
};

(async () => {
  // Check ACS COD Payments
  const results = await acsCODRequest(new Date());

  for (const result of results) {
    await knex("app_orders").where({ or_postID: result.POD }).update({
      or_pay_status: 1,
    });
  }

  // Check ACS Delivery Status
  const selectedRows = await knex
    .select("or_id", "or_postID", "or_paymethod")
    .from("app_orders")
    .where("or_status", 4)
    .andWhere("or_deliverymethod", 2)
    .andWhere("or_pay_status", 0);
  for (const row of selectedRows) {
    let response = await acsRequest(row);
    if (Array.isArray(response))
      await checkAndupdate(response, row.or_paymethod);
  }
  // Check TAS Delivery Status
  const selectedTASRows = await knex
    .select("or_id", "or_postID", "or_paymethod")
    .from("app_orders")
    .where("or_status", 4)
    .andWhere("or_deliverymethod", 5)
    .andWhere("or_pay_status", 0);
  for (const row of selectedTASRows) {
    let responseTas = await tasRequest(row);
    // console.log(responseTas);
    if (Array.isArray(responseTas))
      await checkAndupdateTAS(responseTas, row.or_paymethod);
  }
  await knex.destroy();
})();
