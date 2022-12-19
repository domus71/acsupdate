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

(async () => {
  // Check COD Payments
  const results = await acsCODRequest(new Date("2022-12-7"));

  for (const result of results) {
    await knex("app_orders").where({ or_postID: result.POD }).update({
      or_pay_status: 1,
    });
  }

  // Check Delivery Status
  const selectedRows = await knex
    .select("or_id", "or_postID", "or_paymethod")
    .from("app_orders")
    .where("or_status", 4)
    .andWhere("or_deliverymethod", 2)
    .andWhere("or_pay_status", 0);
  for (const row of selectedRows) {
    let response = await acsRequest(row);
    //console.log(response);
    if (Array.isArray(response))
      await checkAndupdate(response, row.or_paymethod);
  }
  await knex.destroy();
})();
